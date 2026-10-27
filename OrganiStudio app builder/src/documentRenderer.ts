import { materialPath } from "./materialIcons"
import type { DocumentData, OrgNode, TableData } from "./App"

export type ExportOptions = {
  scale: 1 | 2 | 3
  transparent: boolean
  margin: number
}

type Bounds = { minX: number minY: number maxX: number maxY: number }

export function nodeHeight(node: OrgNode, doc: DocumentData) {
  const table = doc.tables.find((item) => item.internalNodeId === node.id)
  return 112 + (table ? 38 + table.rows.length * 34 : 0)
}

export function tableSize(table: TableData) {
  const columns = Math.max(1, table.rows[0]?.length ?? 1)
  return {
    width: Math.max(420, columns * 125),
    height: 40 + table.rows.length * 34,
  }
}

export function contentBounds(doc: DocumentData): Bounds {
  if (!doc.nodes.length && !doc.tables.length)
    return { minX: 0, minY: 0, maxX: 800, maxY: 500 }
  const boxes: Bounds[] = [
    ...doc.nodes.map((node) => ({
      minX: node.x,
      minY: node.y,
      maxX: node.x + node.style.width,
      maxY: node.y + nodeHeight(node, doc),
    })),
    ...doc.tables
      .filter((table) => !table.internalNodeId)
      .map((table) => {
        const size = tableSize(table)
        return {
          minX: table.x ?? 440,
          minY: table.y ?? 510,
          maxX: (table.x ?? 440) + size.width,
          maxY: (table.y ?? 510) + size.height,
        }
      }),
  ]
  return boxes.reduce(
    (result, box) => ({
      minX: Math.min(result.minX, box.minX),
      minY: Math.min(result.minY, box.minY),
      maxX: Math.max(result.maxX, box.maxX),
      maxY: Math.max(result.maxY, box.maxY),
    }),
    boxes[0],
  )
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.roundRect(x, y, width, height, Math.min(radius, height / 2))
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 2,
) {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else line = candidate
  }
  if (line) lines.push(line)
  lines
    .slice(0, maxLines)
    .forEach((value, index) =>
      context.fillText(
        index === maxLines - 1 && lines.length > maxLines ? `${value}…` : value,
        x,
        y + index * lineHeight,
      ),
    )
}

function drawMaterialIcon(
  context: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  context.save()
  context.translate(x, y)
  context.scale(size / 24, size / 24)
  context.fillStyle = color
  context.fill(new Path2D(materialPath(name)))
  context.restore()
}

function drawTable(
  context: CanvasRenderingContext2D,
  table: TableData,
  x: number,
  y: number,
  width?: number,
) {
  const columns = Math.max(1, table.rows[0]?.length ?? 1)
  const actualWidth = width ?? tableSize(table).width
  const cellWidth = actualWidth / columns
  context.fillStyle = "#ffffff"
  context.strokeStyle = "#cfd7e1"
  context.lineWidth = 1
  roundedRect(context, x, y, actualWidth, 40 + table.rows.length * 34, 10)
  context.fill()
  context.stroke()
  context.fillStyle = "#f5f7fa"
  context.fillRect(x, y, actualWidth, 40)
  drawMaterialIcon(context, "analytics", x + 12, y + 11, 18, "#182230")
  context.fillStyle = "#182230"
  context.font = "700 12px Inter, Arial, sans-serif"
  context.fillText(table.title, x + 38, y + 25)
  table.rows.forEach((row, rowIndex) => {
    const rowY = y + 40 + rowIndex * 34
    if (table.header && rowIndex === 0) {
      context.fillStyle = "#e9f2ff"
      context.fillRect(x, rowY, actualWidth, 34)
    }
    row.forEach((cell, columnIndex) => {
      const cellX = x + columnIndex * cellWidth
      context.strokeStyle = "#dce3ea"
      context.strokeRect(cellX, rowY, cellWidth, 34)
      context.fillStyle = "#182230"
      context.font = `${
        table.header && rowIndex === 0 ? "700" : "400"
      } 11px Inter, Arial, sans-serif`
      context.save()
      context.beginPath()
      context.rect(cellX + 1, rowY + 1, cellWidth - 2, 32)
      context.clip()
      context.fillText(cell || "—", cellX + 9, rowY + 21)
      context.restore()
    })
  })
}

export async function renderDocumentCanvas(
  doc: DocumentData,
  options: ExportOptions,
) {
  await document.fonts?.ready
  const bounds = contentBounds(doc)
  const width = Math.ceil(bounds.maxX - bounds.minX + options.margin * 2)
  const height = Math.ceil(bounds.maxY - bounds.minY + options.margin * 2)
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, width * options.scale)
  canvas.height = Math.max(1, height * options.scale)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Il browser non supporta il rendering Canvas.")
  context.scale(options.scale, options.scale)
  if (!options.transparent) {
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, width, height)
  }
  context.translate(options.margin - bounds.minX, options.margin - bounds.minY)

  if (doc.showConnections) {
    context.strokeStyle = "#8e9aaa"
    context.lineWidth = 2
    context.lineJoin = "round"
    doc.nodes.forEach((node) => {
      const parent = doc.nodes.find((item) => item.id === node.parentId)
      if (!parent) return
      const vertical = doc.orientation === "vertical"
      const startX = parent.x + parent.style.width / 2
      const startY = parent.y + nodeHeight(parent, doc)
      const endX = node.x + node.style.width / 2
      const endY = node.y
      context.beginPath()
      context.moveTo(
        vertical ? startX : parent.x + parent.style.width,
        vertical ? startY : parent.y + nodeHeight(parent, doc) / 2,
      )
      if (vertical) {
        context.lineTo(startX, (startY + endY) / 2)
        context.lineTo(endX, (startY + endY) / 2)
        context.lineTo(endX, endY)
      } else {
        const middle = (parent.x + parent.style.width + node.x) / 2
        context.lineTo(middle, parent.y + nodeHeight(parent, doc) / 2)
        context.lineTo(middle, node.y + nodeHeight(node, doc) / 2)
        context.lineTo(node.x, node.y + nodeHeight(node, doc) / 2)
      }
      context.stroke()
    })
  }

  doc.nodes.forEach((node) => {
    const height = nodeHeight(node, doc)
    context.fillStyle = node.style.background
    context.strokeStyle = node.style.borderColor
    context.lineWidth = 2
    roundedRect(
      context,
      node.x,
      node.y,
      node.style.width,
      height,
      node.style.radius,
    )
    context.fill()
    context.stroke()
    context.fillStyle = "#ffffff"
    context.beginPath()
    context.arc(node.x + 43, node.y + 56, 23, 0, Math.PI * 2)
    context.fill()
    drawMaterialIcon(
      context,
      node.icon,
      node.x + 31,
      node.y + 44,
      24,
      "#101828",
    )
    context.fillStyle = node.style.color
    context.font = "700 18px Inter, Arial, sans-serif"
    wrapText(
      context,
      node.title,
      node.x + 78,
      node.y + 47,
      node.style.width - 98,
      21,
      1,
    )
    context.font = `${node.style.italic ? "italic " : ""}${
      node.style.bold ? "700" : "400"
    } 14px Inter, Arial, sans-serif`
    wrapText(
      context,
      node.description,
      node.x + 78,
      node.y + 72,
      node.style.width - 98,
      18,
    )
    const internal = doc.tables.find(
      (table) => table.internalNodeId === node.id,
    )
    if (internal)
      drawTable(
        context,
        internal,
        node.x + 18,
        node.y + 108,
        node.style.width - 36,
      )
  })

  doc.tables
    .filter((table) => !table.internalNodeId)
    .forEach((table) =>
      drawTable(context, table, table.x ?? 440, table.y ?? 510),
    )
  return canvas
}

export function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Impossibile creare il file PNG.")),
      "image/png",
    ),
  )
}

export async function exportPdf(
  doc: DocumentData,
  options: ExportOptions & {
    format: "a4" | "a3"
    orientation: "portrait" | "landscape"
  },
) {
  const { jsPDF } = await import("jspdf")
  const canvas = await renderDocumentCanvas(doc, {
    ...options,
    scale: Math.max(2, options.scale) as 2 | 3,
    transparent: false,
  })
  const pdf = new jsPDF({
    orientation: options.orientation,
    unit: "pt",
    format: options.format,
    compress: true,
  })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const pageMargin = 28
  const ratio = Math.min(
    (pageWidth - pageMargin * 2) / canvas.width,
    (pageHeight - pageMargin * 2) / canvas.height,
  )
  const width = canvas.width * ratio
  const height = canvas.height * ratio
  pdf.addImage(
    canvas.toDataURL("image/png"),
    "PNG",
    (pageWidth - width) / 2,
    (pageHeight - height) / 2,
    width,
    height,
    undefined,
    "FAST",
  )
  pdf.save(`${safeFilename(doc.name)}.pdf`)
}

export function safeFilename(name: string) {
  return (
    name
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "organigramma"
  )
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
