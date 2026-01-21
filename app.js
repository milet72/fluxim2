const fs = require('fs');
const path = require('path');
const fsp = require('fs/promises');
const express = require('express');
const replicate = require ('replicate');
require('dotenv').config();

let GApp =
{
	name: 'Fluxim2',
	port: process.env.PORT || 3000,
	express: express(),
	replicateAPIToken: process.env.REPLICATE_API_TOKEN || '',
	replicate: new replicate({auth: process.env.REPLICATE_API_TOKEN || ''}),
	passwords: [],
	passwordsSep: process.env.PASSWORDS_SEP,
	purgeTimeHours: parseInt(process.env.PURGE_IMAGES_OLDER_THAN),
	logFilePath: 'fluxim2.log'
};
GApp.passwords = process.env.PASSWORDS.split(GApp.passwordsSep);


GApp.express.use(express.static('public'));
GApp.express.use(express.json());
GApp.express.post('/replicate', handleReplicatePOST);
GApp.express.listen(GApp.port, () =>
{
	console.log(`${GApp.name} listening on port ${GApp.port}`)
})
setTimeout(imagePurgeHandler, 3600);

/*
GApp.express.get('/replicate', (req, res) =>
{
	res.send('Hello World!')
})
*/

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

function imagePurgeHandler()
{
	if(GApp.purgeTimeHours<=0)
		return;

	logDT(`Purging files older than ${GApp.purgeTimeHours} hours from "./public/replicate/"`, 'i');
	deleteFilesOlderThan('./public/replicate/', GApp.purgeTimeHours);
} // imagePurgeHandler()

function makeUniqueID()
{
	return Date.now().toString(36).substring(0, 6) + Math.random().toString(36).substring(2, 8).padStart(6, 0);
} // makeUniqueID()

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

function getFullModelName(shortModelName)
{
	let result = '';
	switch(shortModelName)
	{
		case 'flux-schnell':
		case 'flux-dev':
		case 'flux-pro':
		case 'flux-2-klein-4b':
		case 'flux-2-klein-9b-base':
		case 'flux-2-dev':
		case 'flux-2-pro':
			result = 'black-forest-labs/' + shortModelName;
			break;
		case 'hidream-l1-fast':
		case 'p-image':
		case 'z-image-turbo':
			result = 'prunaai/' + shortModelName;
			break;
		case 'qwen-image':
			result = 'qwen/' + shortModelName;
			break;
		default:
			break;
	}
	return result;
} // getFullModelName()

async function ProcessBFLMultiResult(output, outputFormat)
{
	let result = [];

//	if(output.length>0)
//		console.log('ProcessBFLV1Result(), output[0]:', output[0], output[0].url());

	// Write to disk
	for(const [index, item] of Object.entries(output))
	{
		const fileName = `fluxim2-${makeUniqueID()}-${index}.${outputFormat}`;
		const filePath = 'public/replicate/' + fileName;
//		console.log('ProcessBFLV1Result(), result file: ', filePath);
		await fsp.writeFile(filePath, item);
		result.push(fileName);
	}
	return result;
} // ProcessBFLMultiResult()

async function ProcessBFLSingleResult(output, outputFormat)
{
	let result = [];

//	console.log('ProcessBFLV2Result(), output:', output, output.url());

	// Write to disk
	const fileName = `fluxim2-${makeUniqueID()}.${outputFormat}`;
	const filePath = 'public/replicate/' + fileName;
//	console.log('ProcessBFLV2Result(), result file: ', filePath);
	await fsp.writeFile(filePath, output);
	result.push(fileName);

	return result;
} // ProcessBFLSingleResult()

async function handleReplicatePOST(req, res)
{
	if(!process.env.REPLICATE_API_TOKEN)
	{
		console.error('The REPLICATE_API_TOKEN environment variable is not set.');
		return res
			.status(500)
			.json({ detail: 'Server configuration error: missing API token'});
	}

	const ip =
		req.headers['x-forwarded-for'] ||
		req.socket?.remoteAddress ||
		'127.0.0.1';
		
	const json = req.body;
	const shortModelName = json.shortModelName;
	const fullModelName = getFullModelName(shortModelName);
	logDT(`${ip} ${shortModelName}\n"${json.modelPayload.prompt}"`, 'i');
	
	if(!checkPassword(json.password))
	{
		logDT(`${ip} Wrong password: "${json.password}"`, 'e');
		return res
				.status(500)
				.json({ detail: 'Błędne hasło'});
	}

	const input = json.modelPayload;
//	console.log('handleReplicatePOST(), Replicate model:', json.fullModelName);
//	console.log('handleReplicatePOST(), Replicate input:', input);
	
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
	
	let resultPayload;

	switch(shortModelName)
	{
		case 'flux-schnell':
		case 'flux-dev':
		case 'flux-pro':
		case 'flux-2-klein-4b':
		case 'flux-2-klein-9b-base':
		case 'qwen-image':
			resultPayload = await ProcessBFLMultiResult(jobOutput, input.output_format);
			break;
		case 'flux-2-dev':
		case 'flux-2-pro':
		case 'p-image':
		case 'z-image-turbo':
		case 'hidream-l1-fast':
			resultPayload = await ProcessBFLSingleResult(jobOutput, input.output_format);
			break;
		default:
			break;
	}
//	console.log('handleReplicatePOST(), resultPayload:', resultPayload);

	return res.status(201).json(resultPayload);
} // handleReplicatePOST()