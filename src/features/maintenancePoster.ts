// High-resolution A4 poster (2480 x 3508 pixels, approximately 300 DPI).
// Draw everything in the browser so the downloaded image and printout match.
// Hindi is rendered by the browser's Devanagari-capable system font fallback.
const W = 2480
const H = 3508
const navy = '#12223e'
const blue = '#1d4ed8'
const muted = '#526079'
const paper = '#ffffff'

function centerText(ctx: CanvasRenderingContext2D, text: string, y: number, font: string, color: string) {
  ctx.fillStyle = color
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.fillText(text, W / 2, y)
}

function fitCenterText(ctx: CanvasRenderingContext2D, text: string, y: number, maxWidth: number, size: number, color: string) {
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  let current = size
  do {
    ctx.font = `700 ${current}px system-ui, sans-serif`
    if (ctx.measureText(text).width <= maxWidth) break
    current -= 3
  } while (current > 45)
  ctx.fillText(text, W / 2, y)
}

export async function createMaintenancePoster(qrDataUrl: string, branchName: string, requestUrl: string): Promise<string> {
  if ('fonts' in document) await document.fonts.ready
  const qr = new Image()
  qr.src = qrDataUrl
  await new Promise<void>((resolve, reject) => {
    if (qr.complete && qr.naturalWidth) { resolve(); return }
    qr.onload = () => resolve()
    qr.onerror = () => reject(new Error('QR image could not be loaded'))
  })

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not supported by this browser')

  ctx.fillStyle = paper
  ctx.fillRect(0, 0, W, H)

  // Brand header
  ctx.fillStyle = navy
  ctx.fillRect(0, 0, W, 480)
  ctx.fillStyle = '#f5b94e'
  ctx.fillRect(0, 465, W, 15)
  centerText(ctx, 'PG 95', 205, '900 150px system-ui, sans-serif', paper)
  fitCenterText(ctx, branchName, 350, 2090, 72, '#e2e8f0')

  // Bilingual headline
  centerText(ctx, 'समस्या या शिकायत दर्ज करें', 700, '700 112px "Noto Sans Devanagari", "Kohinoor Devanagari", Mangal, sans-serif', navy)
  centerText(ctx, 'MAINTENANCE & COMPLAINTS', 830, '900 99px system-ui, sans-serif', navy)
  centerText(ctx, 'बिजली • पानी • सफ़ाई • मरम्मत', 952, '600 69px "Noto Sans Devanagari", "Kohinoor Devanagari", Mangal, sans-serif', muted)
  centerText(ctx, 'Electrical  •  Plumbing  •  Cleaning  •  Repairs', 1052, '600 53px system-ui, sans-serif', muted)

  // Scan area: retain a completely white quiet zone around the QR.
  ctx.fillStyle = '#f1f5fa'
  ctx.fillRect(280, 1150, 1920, 1560)
  ctx.fillStyle = paper
  ctx.fillRect(650, 1220, 1180, 1180)
  ctx.drawImage(qr, 720, 1290, 1040, 1040)
  centerText(ctx, 'SCAN THE QR CODE / QR कोड स्कैन करें', 2540, '800 77px system-ui, "Noto Sans Devanagari", sans-serif', navy)
  centerText(ctx, 'फोन से स्कैन करें और अपनी शिकायत भेजें', 2650, '600 60px "Noto Sans Devanagari", Mangal, sans-serif', muted)

  // Response time is an estimate, not a guarantee.
  ctx.fillStyle = '#eaf2ff'
  ctx.fillRect(280, 2795, 1920, 280)
  centerText(ctx, '24–48 HOURS  |  24–48 घंटे', 2920, '900 96px system-ui, "Noto Sans Devanagari", sans-serif', blue)
  centerText(ctx, 'समस्या हल करने का हमारा लक्ष्य / Target resolution time', 3015, '600 55px "Noto Sans Devanagari", system-ui, sans-serif', navy)

  centerText(ctx, 'स्कैन करें → जानकारी भरें → टिकट नंबर प्राप्त करें', 3200, '700 59px "Noto Sans Devanagari", Mangal, sans-serif', navy)
  centerText(ctx, 'SCAN  •  SUBMIT COMPLAINT  •  GET TICKET NUMBER', 3298, '700 54px system-ui, sans-serif', muted)

  // QR URL is visibly printed as a fallback for camera issues.
  ctx.fillStyle = '#eef2f7'
  ctx.fillRect(0, 3380, W, 128)
  const shortened = requestUrl.replace(/^https:\/\//, '')
  fitCenterText(ctx, shortened, 3462, 2280, 45, navy)

  return canvas.toDataURL('image/png')
}

export function downloadMaintenancePoster(imageUrl: string, fileName: string) {
  const anchor = document.createElement('a')
  anchor.href = imageUrl
  anchor.download = `PG95-${fileName.replace(/[^a-z0-9-]+/gi, '-').slice(0, 70)}-Maintenance-A4-Poster.png`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export function printMaintenancePoster(imageUrl: string) {
  const win = window.open('', '_blank')
  if (!win) throw new Error('Allow pop-ups to print the poster, or download the A4 poster first.')
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>PG95 Maintenance Poster</title>
  <style>@page{size:A4 portrait;margin:0}html,body{margin:0;padding:0;background:#fff}
  img{display:block;width:210mm;height:297mm;object-fit:fill}
  @media screen{body{min-height:100vh;background:#e5e7eb;display:grid;place-items:center;padding:12px;box-sizing:border-box}img{max-width:100%;height:auto;box-shadow:0 3px 25px #0002}}</style></head>
  <body><img id="poster" alt="PG95 Bilingual Maintenance QR Poster"><script>
  const image=document.getElementById('poster');image.onload=()=>{window.focus();window.print()};
  image.onerror=()=>{document.body.insertAdjacentText('beforeend','Poster failed to load')};
  <\/script></body></html>`
  win.document.open()
  win.document.write(html)
  win.document.close()
  const poster = win.document.getElementById('poster') as HTMLImageElement | null
  if (poster) poster.src = imageUrl
}
