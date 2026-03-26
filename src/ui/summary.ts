import type { NexradProduct } from '../types';
import { PRODUCT_NAMES } from '../parser/header';

export function renderSummary(product: NexradProduct): HTMLElement {
  const card = document.createElement('div');
  card.className = 'summary-card';

  const pd = product.productDescription;
  const mh = product.messageHeader;
  const stats = product.dataStatistics;
  const sym = product.symbology;

  // Elevation angle from P3 (scaled by 0.1)
  const elevAngle = pd.p3 / 10;

  // Packet info
  const packetTypes: string[] = [];
  if (sym) {
    for (const layer of sym.layers) {
      for (const pkt of layer.packets) {
        const code = pkt.packetCode;
        const label = code === 16 ? 'Digital Radial (16)'
          : code === 0xaf1f ? 'Radial RLE (AF1F)'
          : code === 0xba0f ? 'Raster (BA0F)'
          : code === 0xba07 ? 'Raster (BA07)'
          : code === 1 ? 'Text (1)'
          : code === 8 ? 'Text w/ Color (8)'
          : code === 28 ? 'Generic (28)'
          : `Packet ${code.toString(16).toUpperCase()}`;
        if (!packetTypes.includes(label)) packetTypes.push(label);
      }
    }
  }

  // Radial info
  let radialInfo = '';
  if (sym) {
    for (const layer of sym.layers) {
      for (const pkt of layer.packets) {
        if (pkt.packetCode === 16 && 'radials' in pkt) {
          radialInfo = `${pkt.numberOfRadials} radials, ${pkt.numberOfRangeBins} bins/radial`;
          break;
        }
      }
      if (radialInfo) break;
    }
  }

  card.innerHTML = `
    <h2>${product.productName}</h2>
    <div class="summary-grid">
      <div class="summary-section">
        <h3>Product Info</h3>
        <dl>
          <dt>Product Code</dt><dd>${pd.productCode}</dd>
          <dt>Message Code</dt><dd>${mh.messageCode}</dd>
          <dt>File</dt><dd>${product.fileName} (${formatBytes(product.fileSize)})</dd>
          <dt>Version</dt><dd>${pd.version}</dd>
        </dl>
      </div>
      <div class="summary-section">
        <h3>Radar</h3>
        <dl>
          <dt>Source ID</dt><dd>${mh.sourceId}</dd>
          <dt>Location</dt><dd>${pd.latitude.toFixed(3)}&deg;N, ${Math.abs(pd.longitude).toFixed(3)}&deg;${pd.longitude < 0 ? 'W' : 'E'}</dd>
          <dt>Height</dt><dd>${pd.radarHeight} ft MSL</dd>
          <dt>VCP</dt><dd>${pd.vcp}</dd>
          <dt>Op Mode</dt><dd>${pd.operationalModeName}</dd>
        </dl>
      </div>
      <div class="summary-section">
        <h3>Timing</h3>
        <dl>
          <dt>Volume Scan</dt><dd>${pd.volumeScanDateTime.toUTCString()}</dd>
          <dt>Product Generated</dt><dd>${pd.productGenDateTime.toUTCString()}</dd>
          <dt>Message Date</dt><dd>${mh.messageDate.toUTCString()}</dd>
          <dt>Vol Scan #</dt><dd>${pd.volumeScanNumber}</dd>
        </dl>
      </div>
      <div class="summary-section">
        <h3>Data</h3>
        <dl>
          <dt>Elevation</dt><dd>#${pd.elevationNumber} (${elevAngle.toFixed(1)}&deg;)</dd>
          <dt>Packet Types</dt><dd>${packetTypes.join(', ') || 'None'}</dd>
          <dt>Radials</dt><dd>${radialInfo || 'N/A'}</dd>
          <dt>Layers</dt><dd>${sym?.numberOfLayers ?? 0}</dd>
          ${sym?.compressed ? `
          <dt>Compression</dt><dd>bzip2 (${formatBytes(sym.compressedSize!)} &rarr; ${formatBytes(sym.uncompressedSize!)})</dd>
          ` : ''}
        </dl>
      </div>
      ${stats && stats.validBins > 0 ? `
      <div class="summary-section highlight">
        <h3>Data Values</h3>
        <dl>
          <dt>Total Bins</dt><dd>${stats.totalBins.toLocaleString()}</dd>
          <dt>Valid Bins</dt><dd>${stats.validBins.toLocaleString()} (${(stats.validBins / stats.totalBins * 100).toFixed(1)}%)</dd>
          <dt>Below Threshold</dt><dd>${stats.belowThreshold.toLocaleString()}</dd>
          <dt>Range Folded</dt><dd>${stats.rangeFolded.toLocaleString()}</dd>
          <dt>Code Range</dt><dd>${stats.minCode} &ndash; ${stats.maxCode}</dd>
          <dt>Value Range</dt><dd>${stats.minValue.toFixed(1)} &ndash; ${stats.maxValue.toFixed(1)} ${stats.unit}</dd>
          <dt>Mean Value</dt><dd>${stats.meanValue.toFixed(1)} ${stats.unit}</dd>
        </dl>
      </div>
      ` : ''}
      ${product.wmoHeader ? `
      <div class="summary-section">
        <h3>WMO Header</h3>
        <dl>
          <dt>WMO ID</dt><dd>${product.wmoHeader.wmoId}</dd>
          <dt>Station</dt><dd>${product.wmoHeader.station}</dd>
          <dt>AWIPS PIL</dt><dd>${product.wmoHeader.awipsPil}</dd>
          ${product.sbnZlibWrapped ? `
          <dt>Transport</dt><dd><span class="badge">SBN zlib-wrapped</span> &mdash; product was reconstructed from zlib-compressed NOAAPORT SBN frame</dd>
          ` : ''}
        </dl>
      </div>
      ` : ''}
    </div>
  `;

  return card;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
