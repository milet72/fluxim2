const fs = require('fs');
const path = require('path');
const fsp = require('fs/promises');
const express = require('express');
const replicate = require ('replicate');
require('dotenv').config({quiet: true});

/*
** Utility functions
*/
function makeUniqueID()
{
	return Date.now().toString(36).substring(0, 6) + Math.random().toString(36).substring(2, 8).padStart(6, 0);
} // makeUniqueID()

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
					fs.unlink(filePath, () => {});
			});
		}
	});
} // deleteFilesOlderThan()


/*
** Model handling
*/
const GModels =
[
	{name: 'flux-schnell',			provider: 'black-forest-labs',	outputHandler: processMultiResult},
	{name: 'flux-dev',				provider: 'black-forest-labs',	outputHandler: processMultiResult},
	{name: 'flux-pro',				provider: 'black-forest-labs',	outputHandler: processMultiResult},
	{name: 'flux-2-klein-4b',		provider: 'black-forest-labs',	outputHandler: processMultiResult},
	{name: 'flux-2-klein-9b-base',	provider: 'black-forest-labs',	outputHandler: processMultiResult},
	{name: 'flux-2-dev',			provider: 'black-forest-labs',	outputHandler: processSingleResult},
	{name: 'flux-2-pro',			provider: 'black-forest-labs',	outputHandler: processSingleResult},
	{name: 'hidream-l1-fast',		provider: 'prunaai',			outputHandler: processSingleResult},
	{name: 'hidream-l1-dev',		provider: 'prunaai',			outputHandler: processSingleResult},
	{name: 'hidream-l1-full',		provider: 'prunaai',			outputHandler: processSingleResult},
	{name: 'p-image',				provider: 'prunaai',			outputHandler: processSingleResult},
	{name: 'z-image-turbo',			provider: 'prunaai',			outputHandler: processSingleResult},
	{name: 'qwen-image',			provider: 'qwen',				outputHandler: processMultiResult}
] // GModels[]

async function processMultiResult(output, outputFormat)
{
	let result = [];

//	if(output.length>0)
//		console.log('processMultiResult(), output[0]:', output[0], output[0].url());

	// Write to disk
	for(const [index, item] of Object.entries(output))
	{
		const fileName = `${GApp.imgNamePrefix}-${makeUniqueID()}-${index}.${outputFormat}`;
		const filePath = 'public/replicate/' + fileName;
//		console.log('processMultiResult(), result file: ', filePath);
		await fsp.writeFile(filePath, item);
		result.push(fileName);
	}
	return result;
} // processMultiResult()

async function processSingleResult(output, outputFormat)
{
	let result = [];

//	console.log('processSingleResult(), output:', output, output.url());

	// Write to disk
	const fileName = `${GApp.imgNamePrefix}-${makeUniqueID()}.${outputFormat}`;
	const filePath = 'public/replicate/' + fileName;
//	console.log('processSingleResult(), result file: ', filePath);
	await fsp.writeFile(filePath, output);
	result.push(fileName);

	return result;
} // processSingleResult()

function getFullModelName(shortModelName)
{
	let result = '';
	
	for(let i=0; i<GModels.length; i++)
		if(GModels[i].name===shortModelName)
		{
			result = GModels[i].provider +  '/' + shortModelName;
			break;
		}

	return result;
} // getFullModelName()

function getOutputHandler(shortModelName)
{
	let result;
	
	for(let i=0; i<GModels.length; i++)
		if(GModels[i].name===shortModelName)
		{
			result = GModels[i].outputHandler;
			break;
		}

	return result;
} // getOutputHandler()


/*
** Application functions
*/

function imagePurgeHandler()
{
	if(GApp.purgeTimeHours<=0)
		return;

	logDT(`Purging files older than ${GApp.purgeTimeHours} hours from "./public/replicate/"`, 'i');
	deleteFilesOlderThan('./public/replicate/', GApp.purgeTimeHours);
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

	const timestamp = getDateTZ().toLocaleString('pl-PL');
	const typeStr = mapValue(levelMap, level, true);
	const messageDT = `${timestamp}: ${typeStr} ${message}`;
	console.log(messageDT);
	fs.appendFileSync(GApp.logFilePath, messageDT + '\n', 'latin1');
} // logDT()

async function handleReplicatePOST(req, res)
{
	if(!process.env.REPLICATE_API_TOKEN)
	{
		console.error('The REPLICATE_API_TOKEN environment variable is not set.');
		return res
			.status(500)
			.json({ detail: 'Server configuration error: missing API token'});
	}

	const clientIP =
		req.headers['x-forwarded-for'] ||
		req.socket?.remoteAddress ||
		'127.0.0.1';
		
	const json = req.body;
	
	// CHeck password
	if(!checkPassword(json.password))
	{
		logDT(`${clientIP} Wrong password: "${json.password}"`, 'e');
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
//	console.log('handleReplicatePOST(), Replicate model:', json.fullModelName, 'Replicate input:', input);
	
	let jobOutput;
	try
	{
		jobOutput = await GApp.replicate.run(fullModelName, {input});
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
//	console.log('handleReplicatePOST(), Replicate output:', jobOutput);
	
	let resultPayload = {};
	
	const outputHandler = getOutputHandler(shortModelName);
	if(!outputHandler)
	{
		logDT(`${clientIP} No output handler for model: "${shortModelName}"`, 'e');
		return res
				.status(500)
				.json({ detail: 'No output handler!'});
	}

	resultPayload  = await outputHandler(jobOutput, input.output_format);
//	console.log('handleReplicatePOST(), resultPayload:', resultPayload);

	return res
			.status(201)
			.json(resultPayload);
} // handleReplicatePOST()

function initApp()
{
	GApp.passwords = process.env.PASSWORDS.split(GApp.passwordsSep);

	GApp.express.use(express.static('public'));
	GApp.express.use(express.json());
	GApp.express.post('/replicate', handleReplicatePOST);
	GApp.express.listen(GApp.port, () =>
	{
		console.log(`${GApp.name} ${GApp.version} listening on port ${GApp.port}`)
	})
/*
	GApp.express.get('/replicate', (req, res) =>
	{
		res.send('Hello World!')
	})
*/

	setInterval(imagePurgeHandler, 3600 * 1000);
} //initApp()

let GApp =
{
	name: 'Fluxim2',
	version: '0.1',
	imgNamePrefix: 'fluxim2',
	port: process.env.PORT || 3000,
	express: express(),
	replicateAPIToken: process.env.REPLICATE_API_TOKEN || '',
	replicate: new replicate({auth: process.env.REPLICATE_API_TOKEN || ''}),
	passwords: [],
	passwordsSep: process.env.PASSWORDS_SEP,
	purgeTimeHours: parseInt(process.env.PURGE_IMAGES_OLDER_THAN),
	logFilePath: process.env.LOG_FILE
}; // GApp

initApp();