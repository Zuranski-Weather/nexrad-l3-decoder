import './style.css';
import { decodeLevel3 } from './decode';
import { renderSummary } from './ui/summary';
import { renderDetail } from './ui/detail';
import { renderVisualization } from './ui/visualization';

const app = document.getElementById('app')!;

function setupUI() {
  app.innerHTML = `
    <header>
      <h1>NEXRAD Level 3 Decoder</h1>
      <p>Drop a NEXRAD Level 3 product file to decode and inspect its contents.</p>
    </header>
    <div id="drop-zone" class="drop-zone">
      <div class="drop-zone-content">
        <div class="drop-icon">&#x1F4C1;</div>
        <p>Drag &amp; drop a Level 3 file here</p>
        <p class="or-text">or</p>
        <label class="file-button">
          Choose File
          <input type="file" id="file-input" hidden />
        </label>
      </div>
    </div>
    <div id="output"></div>
  `;

  const dropZone = document.getElementById('drop-zone')!;
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const output = document.getElementById('output')!;

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      processFile(files[0], output);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      processFile(fileInput.files[0], output);
    }
  });
}

async function processFile(file: File, output: HTMLElement) {
  output.innerHTML = '<div class="loading">Parsing...</div>';

  try {
    const buffer = await file.arrayBuffer();
    const result = await decodeLevel3(buffer, file.name);

    output.innerHTML = '';
    output.appendChild(renderSummary(result.raw));
    output.appendChild(renderVisualization(result));
    output.appendChild(renderDetail(result.raw));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    output.innerHTML = `<div class="error">
      <h3>Error Parsing File</h3>
      <p>${escapeHtml(message)}</p>
      <pre>${err instanceof Error && err.stack ? escapeHtml(err.stack) : ''}</pre>
    </div>`;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

setupUI();
