const form = document.getElementById('prompt-form');
const output = document.getElementById('output');
const errorBox = document.getElementById('error');

const OUTPUT_FORMAT = 'png';
let lastPrompt = '';
let lastSeed = '';

function aspectToSize(aspectStr, maxSize) {
  const match = aspectStr.match(/(\d+):(\d+)/);
  if (!match) return [maxSize, maxSize];

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width <= 0 || height <= 0) return [maxSize, maxSize];

  if (width === height) return [maxSize, maxSize];
  if (width > height) return [maxSize, Math.floor((maxSize * height) / width)];
  return [Math.floor((maxSize * width) / height), maxSize];
}

function showError(message) {
  errorBox.textContent = message || '';
}

function renderPrediction(prediction) {
  if (!prediction) return;
  const [w, h] = aspectToSize(prediction.aspect_ratio || '1:1', 680);
  const url = prediction.output?.[prediction.output.length - 1];

  let html = `<p class="meta">${lastPrompt} (${lastSeed})<br/>status: ${prediction.status}</p>`;
  if (url) {
    html = `<a href="${url}" download="image-${Math.random().toString(36).slice(2, 8)}.${OUTPUT_FORMAT}" target="_blank" rel="noreferrer">
      <img src="${url}" alt="Generated image" width="${w}" height="${h}" />
    </a>${html}`;
  }

  output.innerHTML = html;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  output.innerHTML = '<p class="meta">Generating image...</p>';

  const seedField = document.getElementById('seed');
  const promptField = document.getElementById('prompt');
  const aspectField = document.getElementById('aspect_ratio');
  const passwordField = document.getElementById('password');
  const modelField = document.getElementById('model');

  const seedValue = parseInt(seedField.value, 10);
  const finalSeed = Number.isNaN(seedValue) ? Math.floor(Math.random() * (1 << 30)) : seedValue;
  lastPrompt = promptField.value.replace(/(\r\n|\n|\r)/gm, ' ');
  lastSeed = finalSeed;

  const payload = {
    model: modelField.value,
    prompt: lastPrompt,
    aspect_ratio: aspectField.value,
    seed: finalSeed,
    output_format: OUTPUT_FORMAT,
    disable_safety_checker: true,
    safety_tolerance: 5,
    password: passwordField.value
  };

  let prediction;
  try {
    const createResponse = await fetch('/api/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    prediction = await createResponse.json();

    if (createResponse.status !== 201) {
      throw new Error(prediction.detail || 'Failed to create prediction');
    }
    renderPrediction(prediction);
  } catch (err) {
    showError(err.message);
    output.innerHTML = '';
    return;
  }

  while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const pollResponse = await fetch(`/api/predictions/${prediction.id}`);
      const next = await pollResponse.json();
      if (pollResponse.status !== 200) {
        throw new Error(next.detail || 'Failed to fetch prediction');
      }
      prediction = next;
      renderPrediction(prediction);
    } catch (err) {
      showError(err.message);
      break;
    }
  }
});
