const pjson = require('./package.json');
const fs = require('fs');
const path = require('path');
const fsp = require('fs/promises');
const { buffer } = require('node:stream/consumers');   
const dns = require('dns').promises;
const express = require('express');
const replicate = require('replicate');
const pngmeta = require('png-metadata-writer');
require('dotenv').config({quiet: true});

/*
** Utility functions
*/
function debug()
{
	if(!GApp.debugEnabled)
		return;
	
	console.log.apply(console, arguments);
} // debug()

function makeUniqueID()
{
	return Date.now().toString(36).substring(0, 6) + Math.random().toString(36).substring(2, 8).padStart(6, 0);
} // makeUniqueID()

async function getFQDN(ip)
{
	let result ='';
	try
	{
		const domains = await dns.reverse(ip);
		result = domains.length > 0 ? domains[0] : '';
	}
	catch (e)
	{
	}
	return result;
} // getFQDN()

function getDateTZ()
{
	const stdTimezoneOffset = () =>
	{
		var jan = new Date(0, 1)
		var jul = new Date(6, 1)
		return Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset())
	}
	
	const getDSTOffset = (date) =>
	{
        return date.getTimezoneOffset() < stdTimezoneOffset() ? 0 : -60;
    }

	let now = new Date();
	now.setMinutes(now.getMinutes() - now.getTimezoneOffset() + getDSTOffset(now));
	return now;
} // getDateTZ()

function mapValue(map, value, doFallback)
{
	let result;

	if(doFallback)
		result = map[0][1];
	for(var i=0; i<map.length; i++)
		if(map[i][0]===value)
		{
			result = map[i][1];
			break;
		}
	return result;
} // mapValue()

function deleteFilesOlderThan(dirPath, hours)
{
	const now = Date.now();
	const maxAgeMs = hours * 60 * 60 * 1000;

	let removedCnt = 0;
	fs.readdir(dirPath, (err, files) =>
	{
		if(err)
			return;

		for(let i=0; i<files.length; i++)
		{
			const filePath = path.join(dirPath, files[i]);

			fs.stat(filePath, (err, stats) =>
			{
				if(err)
					return;
				if(!stats.isFile())
					return;

				const ageMs = now - stats.mtimeMs;
				if(ageMs > maxAgeMs)
				{
					fs.unlink(filePath, () => {});
					removedCnt++;
				}
			});
		}
	});
	return removedCnt;
} // deleteFilesOlderThan()


/*
** Model handling
*/
const GModelInfo =
[
	{name: 'flux-schnell',			provider: 'black-forest-labs',	outputHandler: processMultiResult},
	{name: 'flux-dev',				provider: 'black-forest-labs',	outputHandler: processMultiResult},
	{name: 'flux-pro',				provider: 'black-forest-labs',	outputHandler: processMultiResult},
	{name: 'flux-2-klein-4b',		provider: 'black-forest-labs',	outputHandler: processMultiResult},
	{name: 'flux-2-klein-4b-base',	provider: 'black-forest-labs',	outputHandler: processMultiResult},
	{name: 'flux-2-klein-9b',		provider: 'black-forest-labs',	outputHandler: processMultiResult},
	{name: 'flux-2-klein-9b-base',	provider: 'black-forest-labs',	outputHandler: processMultiResult},
	{name: 'flux-2-dev',			provider: 'black-forest-labs',	outputHandler: processSingleResult},
	{name: 'flux-2-pro',			provider: 'black-forest-labs',	outputHandler: processSingleResult},
	{name: 'hidream-l1-fast',		provider: 'prunaai',			outputHandler: processSingleResult},
	{name: 'hidream-l1-dev',		provider: 'prunaai',			outputHandler: processSingleResult},
	{name: 'hidream-l1-full',		provider: 'prunaai',			outputHandler: processSingleResult},
	{name: 'p-image',				provider: 'prunaai',			outputHandler: processSingleResult},
	{name: 'z-image-turbo',			provider: 'prunaai',			outputHandler: processSingleResult},
	{name: 'qwen-image',			provider: 'qwen',				outputHandler: processMultiResult}
] // GModelInfo[]

function getFullModelName(shortModelName)
{
	let result = '';
	
	for(let i=0; i<GModelInfo.length; i++)
		if(GModelInfo[i].name===shortModelName)
		{
			result = GModelInfo[i].provider +  '/' + shortModelName;
			break;
		}

	return result;
} // getFullModelName()

function getOutputHandler(shortModelName)
{
	let result;
	
	for(let i=0; i<GModelInfo.length; i++)
		if(GModelInfo[i].name===shortModelName)
		{
			result = GModelInfo[i].outputHandler;
			break;
		}

	return result;
} // getOutputHandler()

function addMetaData(buffer, metaData)
{
	let md = {'tEXt': {}};
	md['tEXt']['Title'] = metaData.title;
	md['tEXt']['Author'] = metaData.author;
	md['tEXt']['Description'] = metaData.description;
	md['tEXt']['Copyright'] = metaData.copyright;
	md['tEXt']['Software'] = metaData.software;
	md['tEXt']['Disclaimer'] = metaData.disclaimer;
	md['tEXt']['Warning'] = metaData.warning;
	md['tEXt']['Source'] = metaData.source;
	md['tEXt']['Comment'] = metaData.comment;

	return pngmeta.writeMetadata(buffer, md);
} // addMetaData()

async function writeFile(filePath, output, outputFormat, metaData)
{
	let fileWritten = false;
	debug('writeFile(), output:', output);
	if(GApp.pngMetaDataEnabled && outputFormat=='png')
	{
		// Add metadata
		try
		{
			let buf = await buffer(output);
			buf = addMetaData(buf, metaData);
			await fsp.writeFile(filePath, buf);
			fileWritten = true;
		}
		catch(err)
		{
			const fullMessage = 'writeFile() error: ' + err.message;
			logDT(fullMessage, 'e');
		}
	}
	
	if(!fileWritten)
	{
		// Just write to disk
		await fsp.writeFile(filePath, output);
	}
} // writeFile()

async function processMultiResult(output, outputFormat, metaData)
{
	let result = [];

	if(output.length>0)
		debug('processMultiResult(), output[0]:', output[0], output[0].url());

	for(const [index, item] of Object.entries(output))
	{
		const fileName = `${GApp.imgNamePrefix}-${makeUniqueID()}-${index}.${outputFormat}`;
		const filePath = 'public/replicate/' + fileName;
		debug('processMultiResult(), result file: ', filePath);
		await writeFile(filePath, item, outputFormat, metaData);
		result.push(fileName);
	}
	return result;
} // processMultiResult()

async function processSingleResult(output, outputFormat, metaData)
{
	let result = [];

	debug('processSingleResult(), output:', output);

	const fileName = `${GApp.imgNamePrefix}-${makeUniqueID()}.${outputFormat}`;
	const filePath = 'public/replicate/' + fileName;
	debug('processSingleResult(), result file: ', filePath);
	await writeFile(filePath, output, outputFormat, metaData);
	result.push(fileName);

	return result;
} // processSingleResult()


/*
** Application functions
*/

function imagePurgeHandler()
{
	if(GApp.purgeTimeHours<=0)
		return;

	let	removedCnt = 0;
	try
	{
		removedCnt = deleteFilesOlderThan('./public/replicate/', GApp.purgeTimeHours);
	}
	catch(err)
	{
		const fullMessage = 'imagePurgeHandler() error: ' + err.message;
		logDT(fullMessage, 'e');
	}
	logDT(`Purging files older than ${GApp.purgeTimeHours} hours from "./public/replicate/", removed ${removedCnt} files`, 'i');
} // imagePurgeHandler()

function checkPassword(password)
{
	const isRightPassword = (pass) => pass===password;
	return GApp.passwords.findIndex(isRightPassword) >= 0;
} // checkPassword()

function logDT(message, level)
{
	const levelMap =
		[
			['',	'NONE'],
			['e',	'ERROR'],
			['i',	'INFO'],
			['w',	'WARN']
		]; // levelMap[]

	const timestamp = getDateTZ().toLocaleString(GApp.locale);
	const typeStr = mapValue(levelMap, level, true);
	const messageDT = `${timestamp}: ${typeStr} ${message}`;
	console.log(messageDT);
	fs.appendFileSync(GApp.logFilePath, messageDT + '\n', 'latin1');
} // logDT()

async function handleReplicatePOST(req, res)
{
	const clientIP =
		req.headers['x-forwarded-for'] ||
		req.socket?.remoteAddress ||
		'127.0.0.1';

	const json = req.body;
	
	// Check password
	if(!checkPassword(json.password))
	{
		clientFQDN = await getFQDN(clientIP);
		logDT(`${clientIP} (${clientFQDN}) Wrong password: "${json.password}"`, 'e');
		return res
				.status(500)
				.json({ detail: 'Wrong password!'});
	}

	// Process model name
	const shortModelName = json.shortModelName;
	const fullModelName = getFullModelName(shortModelName);
	if(fullModelName=='')
	{
		logDT(`${clientIP} Model uknown: "${shortModelName}"`, 'e');
		return res
				.status(500)
				.json({ detail: 'Model unknown!'});
	}

	// Log info
	logDT(`${clientIP} ${shortModelName}\n"${json.modelPayload.prompt}"`, 'i');

	const input = json.modelPayload;
	debug('handleReplicatePOST(), Replicate model:', json.fullModelName, 'Replicate input:', input);
	
	let replicateOutput;
	try
	{
		replicateOutput = await GApp.replicate.run(fullModelName, {input});
	}
	catch (err)
	{
		const fullMessage = 'replicate.run() error: ' + err.message;
		logDT(fullMessage, 'e');
		return res
				.status(500)
				.json({ detail: fullMessage});
		return;
	}
	debug('handleReplicatePOST(), Replicate output:', replicateOutput);
	
	let resultPayload = {};
	
	const outputHandler = getOutputHandler(shortModelName);
	if(!outputHandler)
	{
		logDT(`${clientIP} No output handler for model: "${shortModelName}"`, 'e');
		return res
				.status(500)
				.json({ detail: 'No output handler!'});
	}

	const metaData = 
		{
			title:			pjson.name + ' generated image',
			author:			json.userName,
			description:	json.modelPayload.prompt,
			copyright:		'',							// FIX
			software:		`${pjson.name}/${fullModelName}`,
			disclaimer:		'',							// FIX
			warning:		json.modelPayload.disable_safety_checker ? 'Safety filter disabled' : '',
			source:			'',							// FIX
			comment:		'',							// FIX
		}; // metaData{}
	
	resultPayload  = await outputHandler(replicateOutput, input.output_format, metaData);
	debug('handleReplicatePOST(), resultPayload:', resultPayload);

	return res
			.status(201)
			.json(resultPayload);
} // handleReplicatePOST()

async function initApp()
{
	if(GApp.replicateAPIToken=='')
	{
		console.error('The REPLICATE_API_TOKEN environment variable is not set.');
		return;
	}

	GApp.replicate = new replicate({auth: GApp.replicateAPIToken});
	GApp.passwords = process.env.PASSWORDS.split(GApp.passwordsSep);

	GApp.express.use(express.static('public'));
	GApp.express.use(express.json());
	GApp.express.post('/replicate', handleReplicatePOST);
	GApp.express.listen(GApp.port, () =>
	{
		logDT(`${pjson.name} ${pjson.version} listening on port ${GApp.port}`, 'i')
	})

/*
	GApp.express.get('/replicate', (req, res) =>
	{
		res.send('Hello World!')
	})
*/

	setInterval(imagePurgeHandler, 3600 * 1000);
} // initApp()

let GApp =
{
	debugEnabled: process.env['DEBUG_MODE']=='1',
	port: process.env['PORT'] || 3000,
	express: express(),
	replicateAPIToken: process.env['REPLICATE_API_TOKEN'] || '',
	passwords: [],
	passwordsSep: process.env['PASSWORDS_SEP'],
	locale: process.env['LOCALE'],
	purgeTimeHours: parseInt(process.env['PURGE_IMAGES_OLDER_THAN']),
	logFilePath: process.env['LOG_FILE'],
	imgNamePrefix: process.env['IMG_NAME_PREFIX'],
	pngMetaDataEnabled: process.env['PNG_METADATA']=='1'
}; // GApp

initApp();