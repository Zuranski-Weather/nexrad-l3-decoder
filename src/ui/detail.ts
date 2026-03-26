import type { NexradProduct, RadialPacket, RleRadialPacket, RasterPacket, TextPacket, GenericPacket, UnknownPacket } from '../types';
import { toHex } from '../parser/utils';

export function renderDetail(product: NexradProduct): HTMLElement {
  const container = document.createElement('div');
  container.className = 'detail-view';

  // WMO Header
  if (product.wmoHeader) {
    container.appendChild(createSection('WMO / AWIPS Header', () => {
      const div = document.createElement('div');
      div.innerHTML = `<pre class="raw-data">${escapeHtml(product.wmoHeader!.raw)}</pre>`;
      div.appendChild(createTable([
        ['Data Offset', `${product.wmoHeader!.dataOffset} bytes`],
      ]));
      return div;
    }));
  }

  // Message Header
  container.appendChild(createSection('Message Header Block (HW 1-9)', () => {
    const mh = product.messageHeader;
    return createTable([
      ['HW 1: Message Code', `${mh.messageCode}`],
      ['HW 2: Date of Message (MJD)', `${mh.dateOfMessage}`],
      ['HW 3-4: Time of Message', `${mh.timeOfMessage} sec (${mh.messageDate.toUTCString()})`],
      ['HW 5-6: Message Length', `${mh.lengthOfMessage} bytes`],
      ['HW 7: Source ID', `${mh.sourceId}`],
      ['HW 8: Destination ID', `${mh.destinationId}`],
      ['HW 9: Number of Blocks', `${mh.numberOfBlocks}`],
    ]);
  }));

  // Product Description Block
  container.appendChild(createSection('Product Description Block (HW 10-60)', () => {
    const pd = product.productDescription;
    const div = document.createElement('div');

    div.appendChild(createTable([
      ['HW 10: Block Divider', `${pd.blockDivider}`],
      ['HW 11-12: Latitude', `${pd.latitude.toFixed(3)}\u00B0`],
      ['HW 13-14: Longitude', `${pd.longitude.toFixed(3)}\u00B0`],
      ['HW 15: Radar Height', `${pd.radarHeight} ft MSL`],
      ['HW 16: Product Code', `${pd.productCode}`],
      ['HW 17: Operational Mode', `${pd.operationalMode} (${pd.operationalModeName})`],
      ['HW 18: VCP', `${pd.vcp}`],
      ['HW 19: Sequence Number', `${pd.sequenceNumber}`],
      ['HW 20: Volume Scan Number', `${pd.volumeScanNumber}`],
      ['HW 21: Vol Scan Date (MJD)', `${pd.volumeScanDate}`],
      ['HW 22-23: Vol Scan Start Time', `${pd.volumeScanTime} sec (${pd.volumeScanDateTime.toUTCString()})`],
      ['HW 24: Product Gen Date (MJD)', `${pd.productGenDate}`],
      ['HW 25-26: Product Gen Time', `${pd.productGenTime} sec (${pd.productGenDateTime.toUTCString()})`],
      ['HW 27: P1', `${pd.p1}`],
      ['HW 28: P2', `${pd.p2}`],
      ['HW 29: Elevation Number', `${pd.elevationNumber}`],
      ['HW 30: P3 (Elev Angle x10)', `${pd.p3} (${(pd.p3 / 10).toFixed(1)}\u00B0)`],
      ['HW 47: P4', `${pd.p4}`],
      ['HW 48: P5', `${pd.p5}`],
      ['HW 49: P6', `${pd.p6}`],
      ['HW 50: P7', `${pd.p7}`],
      ['HW 51: P8 (Compression)', `${pd.p8} (${pd.p8 === 1 ? 'bzip2' : 'none'})`],
      ['HW 52: P9 (Uncomp Size MSW)', `${pd.p9}`],
      ['HW 53: P10 (Uncomp Size LSW)', `${pd.p10}`],
      ['HW 54: Version / Spot Blank', `${pd.version} / ${pd.spotBlank}`],
      ['HW 55-56: Symbology Offset', `${pd.symbologyOffset} halfwords (${pd.symbologyOffset * 2} bytes)`],
      ['HW 57-58: Graphic Alpha Offset', `${pd.graphicOffset} halfwords`],
      ['HW 59-60: Tabular Alpha Offset', `${pd.tabularOffset} halfwords`],
      ['Computed: Uncompressed Size', `${pd.uncompressedSize} bytes`],
    ]));

    return div;
  }));

  // Data Level Thresholds
  container.appendChild(createSection('Data Level Thresholds (HW 31-46)', () => {
    const pd = product.productDescription;
    const div = document.createElement('div');

    // Raw values
    const rawRows: [string, string][] = pd.dataLevelThresholds.map((v, i) =>
      [`HW ${31 + i}`, `${v} (${toHex(v & 0xffff)})`] as [string, string]
    );
    div.appendChild(createTable(rawRows));

    // Interpreted threshold table (for digital products)
    if (product.thresholdInfo) {
      const ti = product.thresholdInfo;
      const h3 = document.createElement('h4');
      h3.textContent = `Threshold Interpretation (${ti.type})`;
      h3.style.marginTop = '12px';
      div.appendChild(h3);

      const p = document.createElement('p');
      p.className = 'threshold-formula';
      p.textContent = ti.type === 'generic'
        ? `Value = (code \u2212 offset) / scale ${ti.unit} | Code 0 = Below Threshold, Code 1 = Range Folded/Missing`
        : `Value = ${ti.minValue} + (code \u2212 2) \u00D7 ${ti.increment} ${ti.unit} | Code 0 = Below Threshold, Code 1 = Range Folded/Missing | Levels: ${ti.numLevels}`;
      div.appendChild(p);

      // Show a sample of code → value mappings
      const sampleCodes = [0, 1, 2, 3, 10, 50, 100, 150, 200, 254, 255];
      const sampleRows: [string, string][] = sampleCodes
        .filter(c => c <= (ti.numLevels || 255))
        .map(c => {
          const val = ti.codeToValue(c);
          return [`Code ${c}`, val !== null ? `${val.toFixed(1)} ${ti.unit}` : c === 0 ? 'Below Threshold' : 'Range Folded / Missing'] as [string, string];
        });
      div.appendChild(createTable(sampleRows));
    }

    return div;
  }));

  // Symbology Block
  if (product.symbology) {
    container.appendChild(createSection('Product Symbology Block', () => {
      const sym = product.symbology!;
      const div = document.createElement('div');

      div.appendChild(createTable([
        ['Block ID', `${sym.blockId}`],
        ['Block Length', `${sym.blockLength} bytes`],
        ['Number of Layers', `${sym.numberOfLayers}`],
        ['Compressed', sym.compressed ? `Yes (bzip2)` : 'No'],
        ...(sym.compressed ? [
          ['Compressed Size', `${sym.compressedSize!.toLocaleString()} bytes`],
          ['Uncompressed Size', `${sym.uncompressedSize!.toLocaleString()} bytes`],
          ['Ratio', `${(sym.uncompressedSize! / sym.compressedSize!).toFixed(1)}:1`],
        ] as [string, string][] : []),
      ]));

      sym.layers.forEach((layer, layerIdx) => {
        const layerSection = document.createElement('div');
        layerSection.className = 'layer-section';

        const layerHeader = document.createElement('h4');
        layerHeader.textContent = `Layer ${layerIdx + 1} (${layer.layerLength} bytes, ${layer.packets.length} packet(s))`;
        layerSection.appendChild(layerHeader);

        layer.packets.forEach((pkt, pktIdx) => {
          layerSection.appendChild(renderPacketDetail(pkt, pktIdx, product));
        });

        div.appendChild(layerSection);
      });

      return div;
    }));
  }

  // Data Value Statistics
  if (product.dataStatistics && product.dataStatistics.validBins > 0) {
    container.appendChild(createSection('Data Value Statistics', () => {
      const stats = product.dataStatistics!;
      const div = document.createElement('div');

      div.appendChild(createTable([
        ['Total Bins', stats.totalBins.toLocaleString()],
        ['Valid Data Bins', `${stats.validBins.toLocaleString()} (${(stats.validBins / stats.totalBins * 100).toFixed(1)}%)`],
        ['Below Threshold (code 0)', `${stats.belowThreshold.toLocaleString()} (${(stats.belowThreshold / stats.totalBins * 100).toFixed(1)}%)`],
        ['Range Folded (code 1)', `${stats.rangeFolded.toLocaleString()} (${(stats.rangeFolded / stats.totalBins * 100).toFixed(1)}%)`],
        ['Min Code', `${stats.minCode}`],
        ['Max Code', `${stats.maxCode}`],
        ['Min Value', `${stats.minValue.toFixed(1)} ${stats.unit}`],
        ['Max Value', `${stats.maxValue.toFixed(1)} ${stats.unit}`],
        ['Mean Value', `${stats.meanValue.toFixed(1)} ${stats.unit}`],
      ]));

      // Histogram (top 20 most common codes)
      if (stats.histogram.size > 0) {
        const h4 = document.createElement('h4');
        h4.textContent = 'Value Histogram (Top 25 Codes)';
        h4.style.marginTop = '12px';
        div.appendChild(h4);

        const sorted = [...stats.histogram.entries()]
          .filter(([code]) => code >= 2) // skip below threshold and range folded
          .sort((a, b) => b[1] - a[1])
          .slice(0, 25);

        const maxCount = sorted[0]?.[1] || 1;
        const histDiv = document.createElement('div');
        histDiv.className = 'histogram';

        for (const [code, count] of sorted) {
          const pct = (count / maxCount * 100).toFixed(0);
          const val = product.thresholdInfo?.codeToValue(code);
          const valStr = val !== null && val !== undefined ? ` (${val.toFixed(1)} ${stats.unit})` : '';

          const row = document.createElement('div');
          row.className = 'hist-row';
          row.innerHTML = `
            <span class="hist-label">Code ${code}${valStr}</span>
            <span class="hist-bar-container"><span class="hist-bar" style="width:${pct}%"></span></span>
            <span class="hist-count">${count.toLocaleString()}</span>
          `;
          histDiv.appendChild(row);
        }
        div.appendChild(histDiv);
      }

      return div;
    }));
  }

  // Graphic Alphanumeric Block
  if (product.graphicAlphanumeric) {
    container.appendChild(createSection('Graphic Alphanumeric Block', () => {
      const ga = product.graphicAlphanumeric!;
      const div = document.createElement('div');
      div.appendChild(createTable([
        ['Block ID', `${ga.blockId}`],
        ['Block Length', `${ga.blockLength} bytes`],
        ['Number of Pages', `${ga.numberOfPages}`],
      ]));
      ga.pages.forEach((page, i) => {
        const pre = document.createElement('pre');
        pre.className = 'raw-data';
        pre.textContent = `--- Page ${page.pageNumber} ---\n${page.text.join('\n')}`;
        div.appendChild(pre);
      });
      return div;
    }));
  }

  // Tabular Alphanumeric Block
  if (product.tabularAlphanumeric) {
    container.appendChild(createSection('Tabular Alphanumeric Block', () => {
      const ta = product.tabularAlphanumeric!;
      const div = document.createElement('div');
      div.appendChild(createTable([
        ['Block ID', `${ta.blockId}`],
        ['Block Length', `${ta.blockLength || 'N/A'} bytes`],
        ['Number of Pages', `${ta.numberOfPages}`],
      ]));
      ta.pages.forEach((lines, i) => {
        const pre = document.createElement('pre');
        pre.className = 'raw-data';
        pre.textContent = `--- Page ${i + 1} ---\n${lines.join('\n')}`;
        div.appendChild(pre);
      });
      return div;
    }));
  }

  return container;
}

function renderPacketDetail(pkt: any, index: number, product: NexradProduct): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'packet-detail';

  if (pkt.packetCode === 16 && 'radials' in pkt) {
    const rp = pkt as RadialPacket;
    wrapper.appendChild(createCollapsible(`Packet #${index + 1}: Digital Radial Data Array (Code 16)`, () => {
      const div = document.createElement('div');
      div.appendChild(createTable([
        ['Index of First Range Bin', `${rp.indexOfFirstRangeBin}`],
        ['Number of Range Bins', `${rp.numberOfRangeBins}`],
        ['I Center', `${rp.iCenter}`],
        ['J Center', `${rp.jCenter}`],
        ['Scale Factor', `${rp.scaleFactor} (${(rp.scaleFactor / 1000).toFixed(3)})`],
        ['Number of Radials', `${rp.numberOfRadials}`],
      ]));

      // Radial summary table
      const radialHeader = document.createElement('h5');
      radialHeader.textContent = 'Radials';
      radialHeader.style.marginTop = '8px';
      div.appendChild(radialHeader);

      const table = document.createElement('table');
      table.className = 'data-table';
      table.innerHTML = `<thead><tr>
        <th>#</th><th>Start Angle</th><th>Delta</th><th>Bytes</th>
        <th>Non-zero</th><th>Min Code</th><th>Max Code</th>
      </tr></thead>`;
      const tbody = document.createElement('tbody');

      // Show first 20 radials, then a "show all" expander
      const showCount = Math.min(rp.radials.length, 20);
      for (let i = 0; i < showCount; i++) {
        const r = rp.radials[i];
        let nonZero = 0, minC = 256, maxC = -1;
        for (let b = 0; b < r.bins.length; b++) {
          if (r.bins[b] >= 2) {
            nonZero++;
            if (r.bins[b] < minC) minC = r.bins[b];
            if (r.bins[b] > maxC) maxC = r.bins[b];
          }
        }
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${i}</td><td>${r.startAngle.toFixed(1)}\u00B0</td><td>${r.angleDelta.toFixed(1)}\u00B0</td>
          <td>${r.numBytes}</td><td>${nonZero}</td>
          <td>${nonZero > 0 ? minC : '-'}</td><td>${nonZero > 0 ? maxC : '-'}</td>`;
        tbody.appendChild(tr);
      }

      if (rp.radials.length > 20) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="7" class="show-more">... ${rp.radials.length - 20} more radials (${rp.radials.length} total)</td>`;
        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      div.appendChild(table);
      return div;
    }));
  } else if (pkt.packetCode === 0xaf1f && 'radials' in pkt) {
    const rp = pkt as RleRadialPacket;
    wrapper.appendChild(createCollapsible(`Packet #${index + 1}: Radial Data RLE 16-level (Code AF1F)`, () => {
      return createTable([
        ['Index of First Range Bin', `${rp.indexOfFirstRangeBin}`],
        ['Number of Range Bins', `${rp.numberOfRangeBins}`],
        ['I Center', `${rp.iCenter}`],
        ['J Center', `${rp.jCenter}`],
        ['Scale Factor', `${rp.scaleFactor}`],
        ['Number of Radials', `${rp.numberOfRadials}`],
      ]);
    }));
  } else if ((pkt.packetCode === 0xba0f || pkt.packetCode === 0xba07) && 'rows' in pkt) {
    const rp = pkt as RasterPacket;
    wrapper.appendChild(createCollapsible(`Packet #${index + 1}: Raster Data (Code ${toHex(pkt.packetCode)})`, () => {
      return createTable([
        ['I Start', `${rp.iStart}`],
        ['J Start', `${rp.jStart}`],
        ['X Scale', `${rp.xScaleInt}`],
        ['Y Scale', `${rp.yScaleInt}`],
        ['Number of Rows', `${rp.numberOfRows}`],
        ['Packing Descriptor', `${rp.packingDescriptor}`],
      ]);
    }));
  } else if ((pkt.packetCode === 1 || pkt.packetCode === 2 || pkt.packetCode === 8) && 'text' in pkt) {
    const tp = pkt as TextPacket;
    wrapper.appendChild(createCollapsible(`Packet #${index + 1}: Text (Code ${pkt.packetCode})`, () => {
      const div = document.createElement('div');
      div.appendChild(createTable([
        ['I Start', `${tp.iStart}`],
        ['J Start', `${tp.jStart}`],
        ...(tp.colorLevel !== undefined ? [['Color Level', `${tp.colorLevel}`] as [string, string]] : []),
        ['Text Length', `${tp.text.length} chars`],
      ]));
      const pre = document.createElement('pre');
      pre.className = 'raw-data';
      pre.textContent = tp.text;
      div.appendChild(pre);
      return div;
    }));
  } else if ((pkt.packetCode === 28 || pkt.packetCode === 29) && 'rawData' in pkt) {
    const gp = pkt as GenericPacket;
    wrapper.appendChild(createCollapsible(`Packet #${index + 1}: Generic Data (Code ${pkt.packetCode})`, () => {
      return createTable([
        ['Reserved', `${gp.reserved}`],
        ['Data Length', `${gp.dataLength} bytes`],
      ]);
    }));
  } else if ('description' in pkt) {
    const up = pkt as UnknownPacket;
    wrapper.appendChild(createCollapsible(`Packet #${index + 1}: ${up.description} (Code ${toHex(pkt.packetCode)})`, () => {
      return createTable([
        ['Data Length', `${up.rawLength} bytes`],
      ]);
    }));
  }

  return wrapper;
}

function createSection(title: string, contentFn: () => HTMLElement): HTMLElement {
  const section = document.createElement('details');
  section.className = 'detail-section';
  const summary = document.createElement('summary');
  summary.textContent = title;
  section.appendChild(summary);
  section.appendChild(contentFn());
  return section;
}

function createCollapsible(title: string, contentFn: () => HTMLElement): HTMLElement {
  const details = document.createElement('details');
  details.className = 'packet-collapsible';
  const summary = document.createElement('summary');
  summary.textContent = title;
  details.appendChild(summary);
  details.appendChild(contentFn());
  return details;
}

function createTable(rows: [string, string][]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'data-table';
  const tbody = document.createElement('tbody');
  for (const [label, value] of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
