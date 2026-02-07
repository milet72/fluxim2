const pjson = require('./package.json');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { buffer } = require('node:stream/consumers');   
const dns = require('dns').promises;
const https = require('https');
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

function makeDateId()
{
	const d = getDateTZ();

	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');

	return year + month + day;
} // makeDateId()

function makeUniqueId()
{
	return Date.now().toString(36).substring(0, 6) + Math.random().toString(36).substring(2, 8).padStart(6, 0);
} // makeUniqueId()

function makeUniqueFileName(imageIndex, outputFormat)
{
	let fileName = '';
	if(GApp.imgNamePrefix!=='')
		fileName = `${GApp.imgNamePrefix}-`;
	if(imageIndex>=0)
		fileName += `${makeDateId()}-${makeUniqueId()}-${imageIndex}.${outputFormat}`;
	else
		fileName += `${makeDateId()}-${makeUniqueId()}.${outputFormat}`;
	return fileName;
} // makeUniqueFileName()

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

function toLatin1(text)
{
	// Step 1: normalize and remove diacritics
	let out = text
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');

	// Step 2: manual replacements for common non-decomposing chars
	const map =
	{
		"ß": "ss",
		"Æ": "AE",
		"æ": "ae",
		"Ø": "O",
		"ø": "o",
		"Ð": "D",
		"ð": "d",
		"Þ": "Th",
		"þ": "th",
		"Ł": "L",
		"ł": "l",
		"Œ": "OE",
		"œ": "oe",
		"–": "-",
		"—": "-",
		"“": "\"",
		"”": "\"",
		"‘": "'",
		"’": "'"
	}; // map

	out = out.replace(/./g, (ch) =>
	{
		if(map[ch])
			return map[ch];

		// keep only Latin-1 range
		if(ch.charCodeAt(0) <= 0xFF)
			return ch;

		return '';
	});

	return out;
} // toLatin1()

function objectToLatin1(obj)
{
	if(obj === null || typeof obj !== 'object')
		return obj;

	if(Array.isArray(obj))
	{
		for(let i = 0; i < obj.length; i++)
		{
			if(typeof obj[i] === 'string')
				obj[i] = toLatin1(obj[i]);
			else if (typeof obj[i] === 'object')
				objectToLatin1(obj[i]);
		}
		return obj;
	}

	for(const key in obj)
	{
		if(!Object.prototype.hasOwnProperty.call(obj, key))
			continue;

		if(typeof obj[key] === 'string')
			obj[key] = toLatin1(obj[key]);
		else if(typeof obj[key] === 'object')
			objectToLatin1(obj[key]);
	}

	return obj;
} // objectToLatin1()

async function deleteFilesOlderThan(dirPath, hours)
{
	const now = Date.now();
	const maxAgeMs = hours * 60 * 60 * 1000;

	let delCnt = 0;
	const files = await fsp.readdir(dirPath);
	for(const file of files)
	{
		const filePath = path.join(dirPath, file);

		let stats;
		try
		{
			stats = await fsp.stat(filePath);
		}
		catch(err)
		{
			continue; // cannot stat › skip
		}

		if(!stats.isFile())
			continue;

		if(now - stats.mtimeMs > maxAgeMs)
		{
			try
			{
				await fsp.unlink(filePath);
				delCnt++;
			}
			catch(err)
			{
				// unlink failed › permission, lock, race condition, etc.
				// intentionally ignored, but safely handled
			}
		}
	}

	return delCnt;
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
			result = GModelInfo[i].provider + '/' + shortModelName;
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
	const mdL1 = objectToLatin1(metaData);
	const mdTXT =
	{
		'Title':		mdL1.title,
		'Author':		mdL1.author,
		'Description':	mdL1.description,
		'Copyright':	mdL1.copyright,
		'Software':		mdL1.software,
		'Disclaimer':	mdL1.disclaimer,
		'Warning':		mdL1.warning,
		'Source':		mdL1.source,
		'Comment':		mdL1.comment
	};
	const md = {'tEXt': mdTXT};

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
		const fileName = makeUniqueFileName(index, outputFormat);
		const filePath = path.join(GApp.imagePath, fileName);
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

	const fileName = makeUniqueFileName(-1, outputFormat);
	const filePath = path.join(GApp.imagePath, fileName);
	debug('processSingleResult(), result file: ', filePath);
	await writeFile(filePath, output, outputFormat, metaData);
	result.push(fileName);

	return result;
} // processSingleResult()


/*
** Application functions
*/

async function imagePurgeHandler()
{
	if(GApp.purgeTimeHours<=0)
		return;

	const imagePath = `./${GApp.imagePath}`;
	let	delCnt = 0;
	try
	{
		delCnt = await deleteFilesOlderThan(imagePath, GApp.purgeTimeHours);
	}
	catch(err)
	{
		const fullMessage = 'imagePurgeHandler() error: ' + err.message;
		logDT(fullMessage, 'e');
	}
	logDT(`Purging files older than ${GApp.purgeTimeHours} hours from "${imagePath}", deleted ${delCnt} files`, 'i');
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
	const MAX_PROMPT_DISPLAY_LEN = 150;
	let shortPrompt = json.modelPayload.prompt;
	if(shortPrompt.length>MAX_PROMPT_DISPLAY_LEN)
		shortPrompt = shortPrompt.slice(0, MAX_PROMPT_DISPLAY_LEN) + ' [...]';
	logDT(`${clientIP} ${shortModelName}\n"${shortPrompt}"`, 'i');

	const input = json.modelPayload;
	debug('handleReplicatePOST(), Replicate model:', json.fullModelName, 'Replicate input:', input);
	
	let replicateOutput;
	try
	{
		replicateOutput = await GApp.replicate.run(fullModelName, {input});
	}
	catch(err)
	{
		const fullMessage = 'replicate.run() error: ' + err.message;
		logDT(fullMessage, 'e');
		return res
				.status(500)
				.json({ detail: fullMessage});
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
		copyright:		json.metaData.copyright,
		software:		`${pjson.name}/${fullModelName}`,
		disclaimer:		json.metaData.disclaimer,
		warning:		json.modelPayload.disable_safety_checker ? 'Safety filter disabled' : '',
		source:			'',							// FIX
		comment:		json.metaData.comment
	}; // metaData{}
	
	try
	{
		resultPayload  = await outputHandler(replicateOutput, input.output_format, metaData);
		debug('handleReplicatePOST(), resultPayload:', resultPayload);

		return res
				.status(201)
				.json(resultPayload);
	}
	catch(err)
	{
		const fullMessage = outputHandler.toString() + ' error: ' + err.message;
		logDT(fullMessage, 'e');
		return res
				.status(500)
				.json({ detail: fullMessage});
	}
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
	
	GApp.express.use(express.static(GApp.publicPath));
	GApp.express.use(express.json());
	GApp.express.post('/replicate', handleReplicatePOST);
	GApp.express.listen(GApp.port, () =>
	{
		logDT(`${pjson.name} ${pjson.version} listening on port ${GApp.port}`, 'i')
	});
	
	setInterval(imagePurgeHandler, GApp.purgeHandlerInterval * 1000);
} // initApp()

let GApp =
{
	debugEnabled: process.env['DEBUG_MODE']=='1',
	port: process.env['PORT'] || 3000,
	express: express(),
	replicateAPIToken: process.env['REPLICATE_API_TOKEN'] || '',
	publicPath: 'public',
	imagePath: 'public/replicate',
	passwords: [],
	passwordsSep: process.env['PASSWORDS_SEP'],
	locale: process.env['LOCALE'],
	purgeHandlerInterval: 3600,											// In seconds
	purgeTimeHours: parseInt(process.env['PURGE_IMAGES_OLDER_THAN']),
	logFilePath: process.env['LOG_FILE'],
	imgNamePrefix: process.env['IMG_NAME_PREFIX'],
	pngMetaDataEnabled: process.env['PNG_METADATA']=='1'
}; // GApp

initApp();