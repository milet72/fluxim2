const formElem = document.getElementById('prompt-form');
const outputElem = document.getElementById('output');
const errorBoxElem = document.getElementById('error');

const GImagePath = 'replicate/'
const GDebugEnabled = true;
let GLastPrompt = '';
let GLastPromptNoLF = '';
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

function makeRandomText(seed, len)
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
} // makeRandomText()

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
	if(message!=='')
		console.error(message);
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

function replaceAllAll(text, search, replacement)
{
	let prev;
	do
	{
		prev = text;
		text = text.replaceAll(search, replacement);
	}
	while(text!==prev);

	return text;
} // replaceAllAll()

function fixLFCR(text)
{
	let result = text;
	result = replaceAllAll(result, '\r\n', '\n');
	result = replaceAllAll(result, '\n ', '\n');
	result = replaceAllAll(result, ' \n', '\n');
	result = replaceAllAll(result, '\n\n', '\n');
	return result;
} // fixLFCR()

function makeTitleText(prompt)
{
	const noLFCRText = fixLFCR(prompt);
	return `Generated image:\n\n${noLFCRText.slice(0, 500)}`;
} // makeTitleText()

function makeDescrText(prompt)
{
	return fixLFCR(prompt).replaceAll('\n', '<br>');
} // makeDescrText()

function getImageHTML(fileName, w, h)
{
	debug('getImageHTML()', fileName, w, h);
	const url = GImagePath + fileName;
	const title = makeTitleText(GLastPrompt);
	return	`
			<div>
				<a href="${url}" download="${fileName}" target="_blank" rel="noreferrer">
					<img src="${url}" alt="${title}" title="${title}" width="${w}" height="${h}" />
				</a>
			</div>
			<p class="meta">
				<i>Nazwa pliku:</i> <b>${fileName}</b><br>
				<i>Ziarenko:</i> <b>${GLastSeed}</b>
			</p>
			<p class="meta" align="left">
				<i>Opis:</i><br>
				${makeDescrText(GLastPrompt)}
			</p>
			`;
} // getImageHTML()

function renderResult(resultJSON, aspectRatio, imageSize)
{
	debug('renderResult()', resultJSON);
	outputElem.innerHTML = '';

	if(!resultJSON)
	{
		console.error('renderResult(), resultJSON undefined or null');
		return;
	}

	const basePixelSize = imageMPToBaseResolution(imageSize);
	const [w, h] = aspectToSize(aspectRatio, basePixelSize);
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

function getBFLPayload(imageDescr)
{
	const payload = 
	{
		prompt: imageDescr.prompt,
		aspect_ratio: imageDescr.aspectRatio,
		seed: imageDescr.seed,
		output_format: imageDescr.outputFormat,
		disable_safety_checker: imageDescr.disableSafety,
		safety_tolerance: 5,
	};
	return payload;
} // getBFLPayload()

function getPrunaPayload(imageDescr)
{
	const basePixelSize = imageMPToBaseResolution(imageDescr.imageSize);
	console.log('getPrunaPayload()', imageDescr.imageSize, basePixelSize);
	const [w, h] = aspectToSize(imageDescr.aspectRatio, basePixelSize);
	const payload = 
	{
		prompt: imageDescr.prompt,
		aspect_ratio: imageDescr.aspectRatio,
		width: alignTo16(w),
		height: alignTo16(h),
		seed: imageDescr.seed,
		go_fast: imageDescr.goFast,
		output_format: imageDescr.outputFormat,
		disable_safety_checker: imageDescr.disableSafety,
		prompt_upsampling: imageDescr.enhancePrompt,
		guidance_scale: 1,
		num_inference_steps: 8
	};
	if(imageDescr.enhanceRandomness)
	{
		const rndText = makeRandomText(seed, 36);
		payload.prompt += ` [RANDOMIZATION] ${rndText.slice(0, 12)} ${rndText.slice(12, 24)} ${rndText.slice(24, 36)}`;
	}
	return payload;
} // getPrunaPayload()

function getHiDreamPayload(imageDescr)
{
	const payload = 
	{
		prompt: imageDescr.prompt,
		negative_prompt: '',
		aspect_ratio: imageDescr.aspectRatio,
		resolution: aspectToResolutionString(aspectRatio),
		seed: imageDescr.seed,
		speed_mode: imageDescr.goFast ? 'Extra Juiced 🚀 (even more speed)' : 'Unsqueezed 🍋 (highest quality)',
		output_format: imageDescr.outputFormat,
		disable_safety_checker: imageDescr.disableSafety,
	};
	return payload;
} // getHiDreamPayload()

function getQwenPayload(imageDescr)
{
	const payload = 
	{
		prompt: imageDescr.prompt,
		negative_prompt: '',
		aspect_ratio: imageDescr.aspectRatio,
		seed: imageDescr.seed,
		go_fast: imageDescr.goFast,
		output_format: imageDescr.outputFormat,
		disable_safety_checker: imageDescr.disableSafety,
		guidance: 4,
		strength: 0.9,
		image_size: 'optimize_for_quality',
		lora_scale: 1,
		enhance_prompt: imageDescr.enhancePrompt,
		num_inference_steps: 30
	};
	return payload;
} // getQwenPayload()

function getModelPayload(shortModelName, imageDescr)
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
			result = getBFLPayload(imageDescr);
			break;
		// special case: it seems p-image supports JPG only
		case 'p-image':
		{
			const imageDescrP = Object.assign(imageDescr, {outputFormat: 'jpg'});
			if(imageDescrP.aspectRatio=='21:9')
				imageDescrP.aspectRatio = '16:9';
			else if(imageDescrP.aspectRatio=='9:21')
				imageDescrP.aspectRatio = '9:16';
			result = getPrunaPayload(imageDescrP);
			break;
		}
		case 'z-image-turbo':
			result = getPrunaPayload(imageDescr);
			break;
		case 'hidream-l1-fast':
		case 'hidream-l1-dev':
		case 'hidream-l1-full':
			result = getHiDreamPayload(imageDescr);
			break;
		case 'qwen-image':
			result = getQwenPayload(imageDescr);
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

	const shortModelName = modelField.value;
	if(shortModelName=='')
	{
		reportError('Please select model!');
		return;
	}

	const seedValue = parseInt(seedField.value, 10);
	const seedValueOk = !Number.isNaN(seedValue);
	GLastSeed = seedValueOk ? seedValue : Math.floor(Math.random() * (1 << 30));
	
	GLastPrompt = promptField.value;
	if(GLastPrompt=='')
		GLastPrompt = 'Test image';
	GLastPromptNoLF = fixLFCR(GLastPrompt).replaceAll('\n', '. ');

	const aspectRatio = aspectField.value;
	const imageSize = parseInt(imageSizeField.value);
	const fileFormat = fileFormatField.value;

	// Generation parameters pack
	const imageDescr =
	{
		prompt: GLastPromptNoLF,
		aspectRatio: aspectRatio,
		imageSize: imageSize,
		seed: GLastSeed,
		outputFormat: fileFormat,
		goFast: false,
		disableSafety: true,
		enhancePrompt: false,
		enhanceRandomness: !seedValueOk
	};
	const modelPayload = getModelPayload(shortModelName, imageDescr);
	debug('modelPayload', modelPayload);

	const requestPayload =
	{
		shortModelName: shortModelName,
		userName: userNameField.value,
		password: passwordField.value,
		modelPayload: modelPayload,
		metaData:
		{
			copyright: '',					// FIX
			disclaimer: '',					// FIX
			comment: ''						// FIX
		}
	};
	debug('requestPayload', requestPayload);
	
	try
	{
		debug('submitHandler(), before fetch()');
		const fetchRequest = 
		{
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify(requestPayload)
		};
		const replicateResponse = await fetch('/replicate', fetchRequest);
		debug('/replicate response:', replicateResponse);
		if(replicateResponse.status!=201)
		{
			let message = '';
			await replicateResponse.json().then(parsedValue => {message = parsedValue.detail;});
			reportError(`/replicate response: ${replicateResponse.status} (${message})`);
			return;
		}
		replicateResponse.json().then(parsedValue => renderResult(parsedValue, aspectRatio, imageSize));
	}
	catch(err)
	{
		reportError('/replicate error: ' + err.message);
		return;
	}
} // submitHandler()

formElem.addEventListener('submit', submitHandler);
