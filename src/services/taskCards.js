import sharp from 'sharp';

const WIDTH = 1080;
const PADDING = 64;
const CONTENT_WIDTH = WIDTH - PADDING * 2;
export const MAX_TASKS_PER_CARD = 10;

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wrapText(value, maxLength, maxLines = 2) {
  const remaining = Array.from(String(value || '').trim().replace(/\s+/g, ' '));
  const lines = [];
  while (remaining.length && lines.length < maxLines) {
    let splitAt = Math.min(maxLength, remaining.length);
    if (remaining.length > maxLength) {
      const lastSpace = remaining.slice(0, maxLength).lastIndexOf(' ');
      if (lastSpace > 0) splitAt = lastSpace;
    }
    lines.push(remaining.splice(0, splitAt).join('').trim());
    while (remaining[0] === ' ') remaining.shift();
  }
  if (remaining.length && lines.length) {
    const lastLine = Array.from(lines.at(-1));
    lines[lines.length - 1] = `${lastLine.slice(0, maxLength - 1).join('').trimEnd()}…`;
  }
  return lines;
}

function formatDueDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: dateOnly ? 'UTC' : 'Africa/Lagos',
    dateStyle: 'medium',
    ...(dateOnly ? {} : { timeStyle: 'short' })
  }).format(date);
}

function renderLines(lines, x, y, fontSize, fill, lineHeight, weight = 400) {
  return lines.map((line, index) =>
    `<text x="${x}" y="${y + index * lineHeight}" fill="${fill}" font-size="${fontSize}" font-weight="${weight}">${escapeXml(line)}</text>`
  ).join('');
}

function renderTaskRow(task, index, top, singleTask) {
  const titleLines = wrapText(task.title || '(Untitled task)', singleTask ? 34 : 43, 2);
  const notesLines = wrapText(task.notes || '', 68, 2);
  const due = task.due_at || task.due;
  const dueLabel = due ? `Due · ${formatDueDate(due)}` : 'No due date';
  const rowHeight = 126 + Math.max(0, titleLines.length - 1) * 38 + (notesLines.length ? 28 + (notesLines.length - 1) * 26 : 0);
  const badgeFill = task.status === 'completed' ? '#D8F3E7' : '#E5EDFF';
  const badgeText = task.status === 'completed' ? 'DONE' : String(index + 1).padStart(2, '0');
  const titleX = PADDING + 96;
  const titleY = top + 50;
  const notesY = titleY + titleLines.length * 38 + 2;
  const dueY = top + rowHeight - 22;

  return {
    height: rowHeight,
    svg: `
      <rect x="${PADDING}" y="${top}" width="${CONTENT_WIDTH}" height="${rowHeight - 14}" rx="28" fill="#FFFFFF"/>
      <rect x="${PADDING + 24}" y="${top + 24}" width="52" height="52" rx="18" fill="${badgeFill}"/>
      <text x="${PADDING + 50}" y="${top + 58}" text-anchor="middle" fill="#304B73" font-size="17" font-weight="700">${escapeXml(badgeText)}</text>
      ${renderLines(titleLines, titleX, titleY, 29, '#17243A', 38, 650)}
      ${notesLines.length ? renderLines(notesLines, titleX, notesY, 18, '#68778C', 26) : ''}
      <text x="${titleX}" y="${dueY}" fill="#50637D" font-size="17">${escapeXml(dueLabel)}</text>
    `
  };
}

export async function renderTaskListImage(tasks, {
  title = 'Your tasks',
  page = 1,
  totalTasks = tasks.length
} = {}) {
  const shownTasks = tasks.slice(0, MAX_TASKS_PER_CARD);
  const isSingleTask = shownTasks.length === 1;
  const subtitle = isSingleTask
    ? 'TASK DETAILS'
    : `${totalTasks} ${totalTasks === 1 ? 'TASK' : 'TASKS'}${page > 1 ? ` · PAGE ${page}` : ''}`;
  const headerTop = 216;
  const rows = shownTasks.map((task, index) => {
    const row = renderTaskRow(task, index + (page - 1) * MAX_TASKS_PER_CARD, headerTop + rowsHeight(shownTasks, index), isSingleTask);
    return row;
  });
  const rowsHeightTotal = rows.reduce((total, row) => total + row.height, 0);
  const moreTasks = Math.max(0, totalTasks - (page - 1) * MAX_TASKS_PER_CARD - shownTasks.length);
  const footerHeight = moreTasks ? 92 : 56;
  const height = headerTop + rowsHeightTotal + footerHeight;
  const footer = moreTasks
    ? `<text x="${PADDING + 8}" y="${height - 44}" fill="#50637D" font-size="19">+ ${moreTasks} more · Send !tasks ${page + 1}</text>`
    : `<text x="${PADDING + 8}" y="${height - 28}" fill="#8190A4" font-size="16">Made for you by Yvonne · Africa/Lagos time</text>`;
  const svg = `
    <svg width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#F4F7FC"/>
          <stop offset="100%" stop-color="#E8EEF8"/>
        </linearGradient>
        <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#547AE8"/>
          <stop offset="100%" stop-color="#72A6F8"/>
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${height}" fill="url(#background)"/>
      <rect x="${PADDING}" y="48" width="72" height="10" rx="5" fill="url(#accent)"/>
      <text x="${PADDING}" y="112" fill="#17243A" font-size="48" font-weight="700">${escapeXml(title)}</text>
      <text x="${PADDING}" y="158" fill="#718096" font-size="18" letter-spacing="2">${escapeXml(subtitle)}</text>
      ${rows.map(row => row.svg).join('')}
      ${footer}
    </svg>
  `;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function rowsHeight(tasks, endIndex) {
  let height = 0;
  for (let index = 0; index < endIndex; index += 1) {
    const task = tasks[index];
    const titleLines = wrapText(task.title || '(Untitled task)', tasks.length === 1 ? 34 : 43, 2);
    const notesLines = wrapText(task.notes || '', 68, 2);
    height += 126 + Math.max(0, titleLines.length - 1) * 38 + (notesLines.length ? 28 + (notesLines.length - 1) * 26 : 0);
  }
  return height;
}
