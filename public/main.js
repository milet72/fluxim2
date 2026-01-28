const formElem = document.getElementById('prompt-form');
const outputElem = document.getElementById('output');
const errorBoxElem = document.getElementById('error');

const GDebugEnabled = true;
let GLastPrompt = '';
let GLastSeed = '';

function debug()
{
	if(!GDebugEnabled)
		return;
	
	console.log.apply(console, arguments);
} // debug()

function mapValue(map, value, fallbackToFirst)
{
	let result;

	if(fallbackToFirst)
		result = map[0][1];
	for(var i=0; i<map.length; i++)
		if(map[i][0]===value)
		{
			result = map[i][1];
			break;
		}
	return result;
} // mapValue()

function seededRandom(seed)
{
	return function()
	{
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 4294967296;
	};
} // seededRandom()

function randomText(seed, len)
{
	const chars = 'abcdefghijklmnopqrstuvwxyz';
	let result = '';
	const rnd = seededRandom(seed);

	for(let i=0; i<len; i++)
	{
		const idx = Math.floor(rnd() * chars.length);
		result += chars.charAt(idx);
	}

	return result;
} // randomText()

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

function imageMPToBaseResolution(imageMP)
{
	const translationTable =
		[
			[1,	1024],
			[2,	1408],
			[4,	2048],
			[6,	2560],
			[8,	2880]
		]; // translationTable[]

	return mapValue(translationTable, imageMP, true);
} // imageMPToBaseResolution()

function aspectToResolutionString(aspectStr)
{
	const translationTable =
		[
			['1:1',		'1024 × 1024 (Square)'],
			['16:9',	'1360 × 768 (Landscape)'],
			['21:9',	'1360 × 768 (Landscape)'],
			['2:3',		'832 × 1248 (Portrait)'],
			['3:2',		'1248 × 832 (Landscape)'],
			['3:4',		'880 × 1168 (Portrait)'],
			['4:5',		'880 × 1168 (Portrait)'],
			['4:3',		'1168 × 880 (Landscape)'],
			['5:4',		'1168 × 880 (Landscape)'],
			['9:16',	'768 × 1360 (Portrait)'],
			['9:21',	'768 × 1360 (Portrait)']
		]; // translationTable[]

	return mapValue(translationTable, aspectStr, true);
} // aspectToResolutionString()

function reportError(message)
{
	console.log(message);
	errorBoxElem.textContent = message;
	outputElem.innerHTML = '';
} // reportError()

const GModelInfo =
[
	{name: 'flux-schnell',			maxMP: 1},
	{name: 'flux-dev',				maxMP: 1},
	{name: 'flux-pro',				maxMP: 1},
	{name: 'flux-2-klein-4b',		maxMP: 4},
	{name: 'flux-2-klein-4b-base',	maxMP: 4},
	{name: 'flux-2-klein-9b',		maxMP: 4},
	{name: 'flux-2-klein-9b-base',	maxMP: 4},
	{name: 'flux-2-dev',			maxMP: 2},
	{name: 'flux-2-pro',			maxMP: 4},
	{name: 'hidream-l1-fast',		maxMP: 1},
	{name: 'hidream-l1-dev',		maxMP: 1},
	{name: 'hidream-l1-full',		maxMP: 1},
	{name: 'p-image',				maxMP: 2},
	{name: 'z-image-turbo',			maxMP: 4},
	{name: 'qwen-image',			maxMP: 1}
] // GModelInfo[]

function getModelMaxMP(shortModelName)
{
	let result = 1;
	for(let i=0; i<GModelInfo.length; i++)
		if(GModelInfo[i].name===shortModelName)
		{
			result = GModelInfo[i].maxMP;
			break;
		}
	return result;
} // getModelMaxMP()

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
			<p class="meta">
				${GLastPrompt}<br>
				<i>Nazwa pliku:</i> <b>${fileName}</b><br>
				<i>Ziarenko:</i> <b>${GLastSeed}</b>
			</p>
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

function getBFLPayload(prompt, aspectRatio, imageSize, seed, outputFormat, goFast, disableSafety)
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

function getPrunaPayload(prompt, aspectRatio, imageSize, seed, outputFormat, goFast, disableSafety, enhanceRandomness)
{
	const basePixelSize = imageMPToBaseResolution(imageSize);
	console.log('getPrunaPayload()', imageSize, basePixelSize);
	const [w, h] = aspectToSize(aspectRatio, basePixelSize);
	const w16 = alignTo16(w);
	const h16 = alignTo16(h);
	const payload = 
		{
			prompt: prompt,
			aspect_ratio: aspectRatio,
			width: w16,
			height: h16,
			seed: seed,
			go_fast: goFast,
			output_format: outputFormat,
			disable_safety_checker: disableSafety,
			guidance_scale: 1,
			num_inference_steps: 8
		};
	if(enhanceRandomness)
		payload.prompt += '---RANDOM SEED: ' + randomText(seed, 16);
	return payload;
} // getPrunaPayload()

function getHiDreamPayload(prompt, aspectRatio, imageSize, seed, outputFormat, goFast, disableSafety)
{
	const payload = 
		{
			prompt: prompt,
			negative_prompt: '',
			aspect_ratio: aspectRatio,
			resolution: aspectToResolutionString(aspectRatio),
			seed: seed,
			speed_mode: goFast ? 'Extra Juiced 🚀 (even more speed)' : 'Unsqueezed 🍋 (highest quality)',
			output_format: outputFormat,
			disable_safety_checker: disableSafety,
		};
	return payload;
} // getHiDreamPayload()

function getQwenPayload(prompt, aspectRatio, imageSize, seed, outputFormat, goFast, disableSafety)
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
			num_inference_steps: 30
		};
	return payload;
} // getQwenPayload()

function getModelPayload(shortModelName, prompt, aspectRatio, imageSize, seed, outputFormat, goFast, disableSafety)
{
	let result = {};
	switch(shortModelName)
	{
		case 'flux-schnell':
		case 'flux-dev':
		case 'flux-pro':
		case 'flux-2-klein-4b':
		case 'flux-2-klein-4b-base':
		case 'flux-2-klein-9b':
		case 'flux-2-klein-9b-base':
		case 'flux-2-dev':
		case 'flux-2-pro':
			result = getBFLPayload(prompt, aspectRatio, imageSize, seed, outputFormat, goFast, disableSafety);
			break;
		case 'p-image':
		case 'z-image-turbo':
			result = getPrunaPayload(prompt, aspectRatio, imageSize, seed, outputFormat, goFast, disableSafety, true);
			break;
		case 'hidream-l1-fast':
		case 'hidream-l1-dev':
		case 'hidream-l1-full':
			result = getHiDreamPayload(prompt, aspectRatio, imageSize, seed, outputFormat, goFast, disableSafety);
			break;
		case 'qwen-image':
			result = getQwenPayload(prompt, aspectRatio, imageSize, seed, outputFormat, goFast, disableSafety);
			break;
		default:
			break;
	}
	return result;
} // getModelPayload()

function modelChangeHandler(event)
{
	const modelName = document.getElementById('model').value;
	const modelMaxMP = parseInt(getModelMaxMP(modelName));
	if(modelMaxMP>0)
	{
		imageSizeField = document.getElementById('imageSize');
		switch(modelMaxMP)
		{
			case 1:
				imageSizeField.options[0].disabled = false;
				imageSizeField.options[1].disabled = true;
				imageSizeField.options[2].disabled = true;
				imageSizeField.selectedIndex = 0;
				break;
			case 2:
				imageSizeField.options[0].disabled = false;
				imageSizeField.options[1].disabled = false;
				imageSizeField.options[2].disabled = true;
				if(imageSizeField.selectedIndex==2)
					imageSizeField.selectedIndex = 1;
				break;
			case 4:
				imageSizeField.options[0].disabled = false;
				imageSizeField.options[1].disabled = false;
				imageSizeField.options[2].disabled = false;
				break;
			default:
				break;
		}
	}
} // modelChangeHandler()

async function submitHandler(event)
{
	event.preventDefault();
	reportError('');
	outputElem.innerHTML = '<p class="meta">Generating image...</p>';

	const modelField = document.getElementById('model');
	const seedField = document.getElementById('seed');
	const promptField = document.getElementById('prompt');
	const aspectField = document.getElementById('aspectRatio');
	const imageSizeField = document.getElementById('imageSize');
	const fileFormatField = document.getElementById('fileFormat');
	const userNameField = document.getElementById('userName');
	const passwordField = document.getElementById('password');

	const seedValue = parseInt(seedField.value, 10);
	const finalSeed = Number.isNaN(seedValue) ? Math.floor(Math.random() * (1 << 30)) : seedValue;
	const shortModelName = modelField.value;
	if(shortModelName=='')
	{
		reportError('Please select model!');
		return;
	}
	
	const aspectRatio = aspectField.value;
	const imageSize = parseInt(imageSizeField.value);
	const fileFormat = fileFormatField.value;
	GLastPrompt = promptField.value;
	if(GLastPrompt=='')
		GLastPrompt = 'Test image';
	else
		GLastPrompt = GLastPrompt.replaceAll('\r\n', '\n').replaceAll('\n\n', '\n').replaceAll('\n\n', '\n').replaceAll('\n\n', '\n').replaceAll('\n', '. ');
	GLastSeed = finalSeed;

	const modelPayload = getModelPayload(shortModelName, GLastPrompt, aspectRatio, imageSize, finalSeed, fileFormat, false, true);
	//console.log(modelPayload);

	const requestPayload =
	{
		shortModelName: shortModelName,
		userName: userNameField.value,
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
