const formElem = document.getElementById('prompt-form');
const outputElem = document.getElementById('output');
const errorBoxElem = document.getElementById('error');

const OUTPUT_FORMAT = 'png';
const GDebugEnabled = true;
let GLastPrompt = '';
let GLastSeed = '';

function debug()
{
	if(GDebugEnabled)
	{
		var output = '';
		for(var i=0; i<arguments.length; i++)
		{
			if(i>0)
				output += ' ';
			output += String(arguments[i]);
		}
		console.log(output);
	}
} // debug()

function mapValue(map, value, fallback)
{
	let result;

	if(fallback)
		result = map[0][1];
	for(var i=0; i<map.length; i++)
		if(map[i][0]===value)
		{
			result = map[i][1];
			break;
		}
	return result;
} // mapValue()

function aspectToSize(aspectStr, maxSize)
{
	const match = aspectStr.match(/(\d+):(\d+)/);
	if(!match)
		return [maxSize, maxSize];

	const width = Number(match[1]);
	const height = Number(match[2]);
	if(width<=0 || height<=0)
		return [maxSize, maxSize];

	if(width==height)
		return [maxSize, maxSize];
	if(width>height)
		return [maxSize, Math.floor((maxSize * height) / width)];
	else
		return [Math.floor((maxSize * width) / height), maxSize];
} // aspectToSize()

function aspectToResolutionString(aspectStr)
{
	const translationTable =
		[
			['1:1',		'1024 × 1024 (Square)'],
			['16:9',	'1360 × 768 (Landscape)'],
			['21:9',	'1360 × 768 (Landscape)'],
			['2:3',		'832 × 1248 (Portrait)'],
			['3:2',		'1248 × 832 (Landscape)'],
			['4:5',		'880 × 1168 (Portrait)'],
			['5:4',		'1168 × 880 (Landscape)'],
			['9:16',	'768 × 1360 (Portrait)'],
			['9:21',	'768 × 1360 (Portrait)']
		]; // translationTable[]

	return mapValue(translationTable, aspectStr);
} // aspectToResolutionString()

function reportError(message)
{
	console.log(message);
	errorBoxElem.textContent = message;
	outputElem.innerHTML = '';
} // reportError()

function alignTo16(value)
{
	return (value + 15) & ~15;
} // alignTo16()

function getImageHTML(fileName, w, h)
{
	console.log(fileName, w, h);
	const url = 'replicate/' + fileName;
	const title = `Generated image (${GLastPrompt})`;
	return	`
			<div>
				<a href="${url}" download="${fileName}" target="_blank" rel="noreferrer">
					<img src="${url}" alt="${title}" title="${title}" width="${w}" height="${h}" />
				</a>
			</div>
			<p class="meta">${GLastPrompt}<br><i>Ziarenko:</i> <b>${GLastSeed}</b></p>
			`;
} // getImageHTML()

function renderResult(resultJSON, aspectRatio)
{
	debug('renderResult()', resultJSON);
	outputElem.innerHTML = '';

	if(!resultJSON)
	{
		console.log('renderResult(), resultJSON undefined or null');
		return;
	}

	const [w, h] = aspectToSize(aspectRatio, 1024);
	let htmlOutput = '';

	if(Array.isArray(resultJSON))
	{
		for(var i=0; i<resultJSON.length; i++)
			htmlOutput += getImageHTML(resultJSON[i], w, h);
	}
	else
	{
		htmlOutput += getImageHTML(resultJSON, w, h);
	}

	outputElem.innerHTML = htmlOutput;
} // renderResult()

function getBFLPayload(prompt, aspectRatio, seed, outputFormat, goFast, disableSafety)
{
	const payload = 
		{
			prompt: prompt,
			aspect_ratio: aspectRatio,
			seed: seed,
			output_format: outputFormat,
			disable_safety_checker: disableSafety,
			safety_tolerance: 5,
		};
	return payload;
} // getBFLPayload()

function getPrunaPayload(prompt, aspectRatio, seed, outputFormat, goFast, disableSafety)
{
	const [w, h] = aspectToSize(aspectRatio, 1024);
	const w16 = alignTo16(w);
	const h16 = alignTo16(h);
	const payload = 
		{
			prompt: prompt,
			negative_prompt: "",
			aspect_ratio: aspectRatio,
			resolution: aspectToResolutionString(aspectRatio),
			width: w16,
			height: h16,
			seed: seed,
			go_fast: goFast,
			speed_mode: goFast ? 'Extra Juiced 🚀 (even more speed)' : 'Unsqueezed 🍋 (highest quality)',
			output_format: outputFormat,
			disable_safety_checker: disableSafety,
			guidance_scale: 0,
			num_inference_steps: 8
		};
	return payload;
} // getPrunaPayload()

function getQwenPayload(prompt, aspectRatio, seed, outputFormat, goFast, disableSafety)
{
	const payload = 
		{
			prompt: prompt,
			negative_prompt: "",
			aspect_ratio: aspectRatio,
			seed: seed,
			go_fast: goFast,
			output_format: outputFormat,
			disable_safety_checker: disableSafety,
			guidance: 4,
			strength: 0.9,
			image_size: "optimize_for_quality",
			lora_scale: 1,
			enhance_prompt: false,
			num_inference_steps: 50
		};
	return payload;
} // getQwenPayload()

function getModelPayload(shortModelName, prompt, aspectRatio, seed, outputFormat, goFast, disableSafety)
{
	let result = {};
	switch(shortModelName)
	{
		case 'flux-schnell':
		case 'flux-dev':
		case 'flux-pro':
		case 'flux-2-klein-4b':
		case 'flux-2-klein-9b-base':
		case 'flux-2-dev':
		case 'flux-2-pro':
			result = getBFLPayload(prompt, aspectRatio, seed, outputFormat, goFast, disableSafety);
			break;
		case 'p-image':
		case 'z-image-turbo':
		case 'hidream-l1-fast':
			result = getPrunaPayload(prompt, aspectRatio, seed, outputFormat, goFast, disableSafety);
			break;
		case 'qwen-image':
			result = getQwenPayload(prompt, aspectRatio, seed, outputFormat, goFast, disableSafety);
			break;
		default:
			break;
	}
	return result;
} // getModelPayload()

async function submitHandler(event)
{
	console.log('submitHandler() entry');
	event.preventDefault();
	reportError('');
	outputElem.innerHTML = '<p class="meta">Generating image...</p>';

	const seedField = document.getElementById('seed');
	const promptField = document.getElementById('prompt');
	const aspectField = document.getElementById('aspectRatio');
	const passwordField = document.getElementById('password');
	const modelField = document.getElementById('model');

	const seedValue = parseInt(seedField.value, 10);
	const finalSeed = Number.isNaN(seedValue) ? Math.floor(Math.random() * (1 << 30)) : seedValue;
	const shortModelName = modelField.value;
	if(shortModelName=='')
	{
		reportError('Please select modeel!');
		return;
	}
	
	const aspectRatio = aspectField.value;
	GLastPrompt = promptField=='' ? 'test image' : promptField.value.replace(/(\r\n|\n|\r)/gm, '. ');
	GLastSeed = finalSeed;

	const modelPayload = getModelPayload(shortModelName, GLastPrompt, aspectRatio, finalSeed, OUTPUT_FORMAT, false, true);
	debug(modelPayload);

	const requestPayload =
	{
		shortModelName: shortModelName,
		password: passwordField.value,
		modelPayload: modelPayload
	};
	debug(requestPayload);
	
	let replicateRequest;
	try
	{
		debug('submitHandler(), before fetch()');
		const replicateResponse = await fetch('/replicate',
			{
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify(requestPayload)
			});
		debug('/replicate response:', replicateResponse);
		if(replicateResponse.status!=201)
		{
			let message = '';
			await replicateResponse.json().then(parsedValue => {message = parsedValue.detail;});
			reportError(`/replicate response: ${replicateResponse.status} (${message})`);
			return;
		}
		replicateResponse.json().then(parsedValue => renderResult(parsedValue, aspectRatio));
	}
	catch (err)
	{
		reportError('/replicate error: ' + err.message);
		return;
	}
} // submitHandler()

formElem.addEventListener('submit', submitHandler);
