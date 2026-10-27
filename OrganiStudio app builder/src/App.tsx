import {
  ChangeEvent,
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import {
  canvasBlob,
  contentBounds,
  downloadBlob,
  exportPdf,
  nodeHeight,
  renderDocumentCanvas,
  safeFilename,
  tableSize,
} from "./documentRenderer"
import { MaterialIcon, materialPath } from "./materialIcons"

export type NodeStyle = {
  background: string
  borderColor: string
  color: string
  radius: number
  width: number
  padding: number
  bold?: boolean
  italic?: boolean
}

export type TableData = {
  id: string
  title: string
  rows: string[][]
  header: boolean
  internalNodeId?: string
  x?: number
  y?: number
}

export type OrgNode = {
  id: string
  parentId: string | null
  title: string
  description: string
  icon: string
  x: number
  y: number
  collapsed?: boolean
  style: NodeStyle
}

export type DocumentData = {
  schemaVersion: 1
  id: string
  name: string
  nodes: OrgNode[]
  tables: TableData[]
  orientation: "vertical" | "horizontal"
  layoutMode: "automatico" | "libero"
  showGrid: boolean
  showConnections: boolean
  levelGap: number
  nodeGap: number
  levelNames: Record<number, string>
}

const DEFAULT_STYLE: NodeStyle = {
  background: "#84A8EA",
  borderColor: "#84A8EA",
  color: "#101828",
  radius: 20,
  width: 360,
  padding: 20,
}

const iconGroups = {
  Persone: ["person", "groups", "badge", "manage_accounts"],
  Organizzazione: ["business", "account_tree", "corporate_fare", "hub"],
  Lavoro: ["work", "engineering", "assignment", "analytics"],
  Tecnologia: ["computer", "memory", "code", "cloud"],
  Comunicazione: ["mail", "forum", "call", "campaign"],
  Servizi: ["support_agent", "settings", "handyman", "verified"],
}

const uid = () => Math.random().toString(36).slice(2, 10)

function demoDocument(): DocumentData {
  const root = uid()
  return {
    schemaVersion: 1,
    id: uid(),
    name: "Organigramma aziendale",
    orientation: "vertical",
    layoutMode: "automatico",
    showGrid: true,
    showConnections: true,
    levelGap: 120,
    nodeGap: 42,
    levelNames: { 0: "Direzione", 1: "Responsabili" },
    tables: [],
    nodes: [
      {
        id: root,
        parentId: null,
        title: "Direzione",
        description: "Guida strategica e coordinamento aziendale",
        icon: "account_tree",
        x: 560,
        y: 70,
        style: { ...DEFAULT_STYLE },
      },
      {
        id: uid(),
        parentId: root,
        title: "Area operativa",
        description: "Processi, persone e attività quotidiane",
        icon: "groups",
        x: 110,
        y: 300,
        style: { ...DEFAULT_STYLE },
      },
      {
        id: uid(),
        parentId: root,
        title: "Amministrazione",
        description: "Finanza, controllo e servizi generali",
        icon: "business",
        x: 560,
        y: 300,
        style: { ...DEFAULT_STYLE },
      },
      {
        id: uid(),
        parentId: root,
        title: "Area tecnica",
        description: "Progettazione, sviluppo e innovazione",
        icon: "engineering",
        x: 1010,
        y: 300,
        style: { ...DEFAULT_STYLE },
      },
    ],
  }
}

function depthOf(node: OrgNode, nodes: OrgNode[]) {
  let depth = 0
  let current = node
  const visited = new Set<string>()
  while (current.parentId && !visited.has(current.id)) {
    visited.add(current.id)
    const parent = nodes.find((item) => item.id === current.parentId)
    if (!parent) break
    depth += 1
    current = parent
  }
  return depth
}

function descendants(id: string, nodes: OrgNode[]): OrgNode[] {
  const children = nodes.filter((node) => node.parentId === id)
  return children.flatMap((child) => [child, ...descendants(child.id, nodes)])
}

function autoLayout(doc: DocumentData): DocumentData {
  const nodes = doc.nodes.map((node) => ({ ...node }))
  const roots = nodes.filter((node) => !node.parentId)
  let leafCursor = 80
  const vertical = doc.orientation === "vertical"
  const levelHeights = new Map<number, number>()
  nodes.forEach((node) => {
    const level = depthOf(node, nodes)
    const table = doc.tables.find((item) => item.internalNodeId === node.id)
    const height = 112 + (table ? 50 + table.rows.length * 34 : 0)
    levelHeights.set(level, Math.max(levelHeights.get(level) ?? 0, height))
  })
  const levelOffset = (depth: number) => {
    let offset = 80
    for (let index = 0; index < depth; index += 1) {
      offset += (levelHeights.get(index) ?? 112) + doc.levelGap
    }
    return offset
  }
  const place = (node: OrgNode, depth: number): number => {
    const children = nodes.filter((item) => item.parentId === node.id)
    let primary: number
    if (!children.length || node.collapsed) {
      primary = leafCursor
      leafCursor += node.style.width + doc.nodeGap
    } else {
      const positions = children.map((child) => place(child, depth + 1))
      primary = (positions[0] + positions[positions.length - 1]) / 2
    }
    if (vertical) {
      node.x = primary
      node.y = levelOffset(depth)
    } else {
      node.x = 80 + depth * (node.style.width + doc.levelGap)
      node.y = primary / 1.8
    }
    return primary
  }
  roots.forEach((root) => place(root, 0))
  return { ...doc, nodes }
}

function Icon({
  name,
  size = 20,
  className = "",
}: {
  name: string
  size?: number
  className?: string
}) {
  return <MaterialIcon name={name} size={size} className={className} />
}

function TooltipLayer() {
  const [tooltip, setTooltip] = useState<{
    text: string
    x: number
    y: number
    above: boolean
  } | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    const close = () => {
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = null
      setTooltip(null)
    }
    const show = (target: HTMLElement) => {
      const text = target.dataset.tooltip
      if (!text) return
      close()
      timer.current = window.setTimeout(() => {
        const box = target.getBoundingClientRect()
        const estimatedWidth = Math.min(300, Math.max(120, text.length * 6.5))
        const above = box.bottom + 50 > window.innerHeight
        setTooltip({
          text,
          x: Math.min(
            window.innerWidth - estimatedWidth / 2 - 10,
            Math.max(estimatedWidth / 2 + 10, box.left + box.width / 2),
          ),
          y: above ? box.top - 10 : box.bottom + 10,
          above,
        })
      }, 400)
    }
    const findTarget = (event: Event) =>
      (event.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-tooltip]",
      )
    const onOver = (event: MouseEvent) => {
      const target = findTarget(event)
      if (target) show(target)
    }
    const onOut = (event: MouseEvent) => {
      const target = findTarget(event)
      if (target && !target.contains(event.relatedTarget as Node)) close()
    }
    const onFocus = (event: FocusEvent) => {
      const target = findTarget(event)
      if (target) show(target)
    }
    const onBlur = () => close()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    document.addEventListener("mouseover", onOver)
    document.addEventListener("mouseout", onOut)
    document.addEventListener("focusin", onFocus)
    document.addEventListener("focusout", onBlur)
    document.addEventListener("keydown", onKey)
    return () => {
      close()
      document.removeEventListener("mouseover", onOver)
      document.removeEventListener("mouseout", onOut)
      document.removeEventListener("focusin", onFocus)
      document.removeEventListener("focusout", onBlur)
      document.removeEventListener("keydown", onKey)
    }
  }, [])

  if (!tooltip) return null
  return createPortal(
    <div
      className={`shared-tooltip ${tooltip.above ? "above" : ""}`}
      role="tooltip"
      style={{ left: tooltip.x, top: tooltip.y }}
    >
      {tooltip.text}
    </div>,
    document.body,
  )
}

function ToolButton({
  icon,
  label,
  onClick,
  disabled,
  active,
}: {
  icon: string
  label: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-tooltip={label}
    >
      <Icon name={icon} size={19} />
    </button>
  )
}

function TopBar({
  doc,
  saveState,
  setName,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onNew,
  onOpen,
  onImport,
  onExport,
  onPresentation,
}: {
  doc: DocumentData
  saveState: string
  setName: (name: string) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onNew: () => void
  onOpen: () => void
  onImport: () => void
  onExport: () => void
  onPresentation: () => void
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <Icon name="account_tree" size={22} />
        </div>
        <strong>OrganiStudio</strong>
      </div>
      <div className="document-title">
        <input
          value={doc.name}
          aria-label="Nome documento"
          onChange={(event) => setName(event.target.value)}
        />
        <span
          className={`save-state ${saveState === "Salvato" ? "saved" : ""}`}
        >
          <span />
          {saveState}
        </span>
      </div>
      <div className="top-actions">
        <div className="button-group">
          <ToolButton
            icon="undo"
            label="Annulla — Ctrl/Cmd + Z"
            onClick={onUndo}
            disabled={!canUndo}
          />
          <ToolButton
            icon="redo"
            label="Ripeti — Ctrl/Cmd + Shift + Z"
            onClick={onRedo}
            disabled={!canRedo}
          />
        </div>
        <button className="text-button" onClick={onNew}>
          <Icon name="add" /> Nuovo
        </button>
        <button className="text-button" onClick={onOpen}>
          <Icon name="folder_open" /> Apri
        </button>
        <button className="text-button compact" onClick={onImport}>
          <Icon name="upload" /> Importa
        </button>
        <button className="text-button compact" onClick={onExport}>
          <Icon name="download" /> Esporta
        </button>
        <button className="primary-button" onClick={onPresentation}>
          <Icon name="present_to_all" /> Presentazione
        </button>
      </div>
    </header>
  )
}

function LeftPanel({
  doc,
  selected,
  onSelect,
  onAddRoot,
  onAddTable,
  onTemplate,
  onToggleBranch,
}: {
  doc: DocumentData
  selected: string[]
  onSelect: (id: string) => void
  onAddRoot: () => void
  onAddTable: () => void
  onTemplate: (kind: "vuoto" | "semplice" | "tre-livelli") => void
  onToggleBranch: (id: string) => void
}) {
  const [tab, setTab] = useState<"struttura" | "elementi" | "modelli">(
    "struttura",
  )
  const [query, setQuery] = useState("")
  const visible = doc.nodes.filter((node) =>
    `${node.title} ${node.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  )
  return (
    <aside className="left-panel">
      <div className="panel-tabs">
        {(["struttura", "elementi", "modelli"] as const).map((item) => (
          <button
            key={item}
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>
      {tab === "struttura" && (
        <div className="panel-content">
          <label className="search">
            <Icon name="search" size={19} />
            <input
              placeholder="Cerca nell’organigramma"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="section-heading">
            <span>Struttura</span>
            <span>{doc.nodes.length} elementi</span>
          </div>
          <div className="tree">
            {visible
              .sort((a, b) => depthOf(a, doc.nodes) - depthOf(b, doc.nodes))
              .map((node) => {
                const depth = depthOf(node, doc.nodes)
                const hasChildren = doc.nodes.some(
                  (item) => item.parentId === node.id,
                )
                return (
                  <button
                    key={node.id}
                    className={`tree-row ${
                      selected.includes(node.id) ? "selected" : ""
                    }`}
                    style={{ paddingLeft: 10 + depth * 17 }}
                    onClick={() => onSelect(node.id)}
                  >
                    <span
                      className="tree-chevron"
                      role="button"
                      tabIndex={hasChildren ? 0 : -1}
                      aria-label={
                        node.collapsed ? "Espandi ramo" : "Comprimi ramo"
                      }
                      data-tooltip={
                        node.collapsed ? "Espandi ramo" : "Comprimi ramo"
                      }
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleBranch(node.id)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          event.stopPropagation()
                          onToggleBranch(node.id)
                        }
                      }}
                    >
                      {hasChildren ? (
                        <Icon
                          name={
                            node.collapsed ? "chevron_right" : "expand_more"
                          }
                        />
                      ) : null}
                    </span>
                    <Icon name={node.icon} size={18} />
                    <span>{node.title}</span>
                    <small>L{depth + 1}</small>
                  </button>
                )
              })}
          </div>
        </div>
      )}
      {tab === "elementi" && (
        <div className="panel-content">
          <p className="panel-intro">
            Trascina o inserisci un elemento nel canvas.
          </p>
          <button className="element-card" onClick={onAddRoot}>
            <Icon name="badge" size={24} />
            <span>
              <strong>Scheda</strong>
              <small>Persona, ruolo o reparto</small>
            </span>
            <Icon name="add" />
          </button>
          <button className="element-card" onClick={onAddTable}>
            <Icon name="table" size={24} />
            <span>
              <strong>Tabella</strong>
              <small>Griglia modificabile</small>
            </span>
            <Icon name="add" />
          </button>
          <button className="element-card" onClick={onAddRoot}>
            <Icon name="sticky_note_2" size={24} />
            <span>
              <strong>Nota di testo</strong>
              <small>Annotazione libera</small>
            </span>
            <Icon name="add" />
          </button>
        </div>
      )}
      {tab === "modelli" && (
        <div className="panel-content template-list">
          <p className="panel-intro">Scegli una base per il documento.</p>
          <button onClick={() => onTemplate("vuoto")}>
            <Icon name="draft" />
            Organigramma vuoto
          </button>
          <button onClick={() => onTemplate("semplice")}>
            <Icon name="account_tree" />
            Radice e tre reparti
          </button>
          <button onClick={() => onTemplate("tre-livelli")}>
            <Icon name="lan" />
            Struttura a tre livelli
          </button>
        </div>
      )}
      <div className="panel-footer">
        <Icon name="cloud_done" size={18} /> Salvato in questo dispositivo
      </div>
    </aside>
  )
}

function OrgCard({
  node,
  table,
  selected,
  multi,
  onSelect,
  onUpdate,
  onAddChild,
  onAddSibling,
  onIcon,
  onDragStart,
}: {
  node: OrgNode
  table?: TableData
  selected: boolean
  multi: boolean
  onSelect: (event: ReactMouseEvent, id: string) => void
  onUpdate: (id: string, patch: Partial<OrgNode>) => void
  onAddChild: (id: string) => void
  onAddSibling: (id: string) => void
  onIcon: (id: string) => void
  onDragStart: (event: ReactMouseEvent, id: string) => void
}) {
  const style = {
    "--node-bg": node.style.background,
    "--node-border": node.style.borderColor,
    "--node-color": node.style.color,
    "--node-radius": `${node.style.radius}px`,
    "--node-width": `${node.style.width}px`,
    "--node-padding": `${node.style.padding}px`,
    "--node-weight": node.style.bold ? "700" : "400",
    "--node-font-style": node.style.italic ? "italic" : "normal",
    left: node.x,
    top: node.y,
  } as CSSProperties
  return (
    <article
      className={`org-card ${selected ? "selected" : ""} ${
        multi ? "multi" : ""
      }`}
      style={style}
      onMouseDown={(event) => onSelect(event, node.id)}
      onPointerDown={(event) => {
        if (
          (event.target as HTMLElement).closest(
            "button,input,textarea,[contenteditable]",
          )
        )
          return
        onDragStart(event as unknown as ReactMouseEvent, node.id)
      }}
      data-export-node="true"
    >
      <button
        className="card-icon"
        onClick={() => onIcon(node.id)}
        aria-label="Cambia icona"
        data-tooltip="Modifica icona"
      >
        <Icon name={node.icon} size={25} />
      </button>
      <div className="card-copy">
        <input
          className="card-title"
          value={node.title}
          aria-label="Titolo scheda"
          onChange={(event) => onUpdate(node.id, { title: event.target.value })}
          onMouseDown={(event) => event.stopPropagation()}
        />
        <textarea
          className="card-description"
          value={node.description}
          aria-label="Descrizione scheda"
          rows={2}
          onChange={(event) =>
            onUpdate(node.id, { description: event.target.value })
          }
          onMouseDown={(event) => event.stopPropagation()}
        />
      </div>
      {table && (
        <div
          className="internal-table"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <strong>{table.title}</strong>
          <table>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, columnIndex) => (
                    <td key={columnIndex}>{cell || "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="quick-actions editor-only">
        <button
          onClick={() => onAddSibling(node.id)}
          aria-label="Aggiungi pari livello"
          data-tooltip="Aggiungi pari livello"
        >
          <img src="/assets/9ed58.svg" alt="" />
        </button>
        <button
          onClick={() => onAddChild(node.id)}
          aria-label="Aggiungi subordinato"
          data-tooltip="Aggiungi subordinato"
        >
          <img src="/assets/9ed58.svg" alt="" />
        </button>
      </div>
      {selected && (
        <>
          <i className="resize-handle top-left" />
          <i className="resize-handle top-right" />
          <i className="resize-handle bottom-left" />
          <i className="resize-handle bottom-right" />
        </>
      )}
    </article>
  )
}

function DataTable({
  table,
  selected,
  onSelect,
  onUpdate,
}: {
  table: TableData
  selected: boolean
  onSelect: () => void
  onUpdate: (table: TableData) => void
}) {
  const updateCell = (row: number, col: number, value: string) => {
    const rows = table.rows.map((item) => [...item])
    rows[row][col] = value
    onUpdate({ ...table, rows })
  }
  return (
    <div
      className={`data-table ${selected ? "selected" : ""}`}
      style={{ left: table.x ?? 440, top: table.y ?? 510 }}
      onMouseDown={onSelect}
      data-export-node="true"
    >
      <div className="table-title">
        <Icon name="table" size={18} />
        {table.title}
      </div>
      <table>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className={table.header && rowIndex === 0 ? "header-row" : ""}
            >
              {row.map((cell, colIndex) => (
                <td key={colIndex}>
                  <input
                    value={cell}
                    aria-label={`Riga ${rowIndex + 1}, colonna ${colIndex + 1}`}
                    onChange={(event) =>
                      updateCell(rowIndex, colIndex, event.target.value)
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Canvas({
  doc,
  selected,
  zoom,
  pan,
  tool,
  spacePressed,
  canvasRef,
  setPan,
  setZoom,
  onSelect,
  onClear,
  onMarquee,
  onUpdate,
  onAddChild,
  onAddSibling,
  onIcon,
  onDragStart,
  onTableSelect,
  onTableUpdate,
}: {
  doc: DocumentData
  selected: string[]
  zoom: number
  pan: { x: number y: number }
  tool: "select" | "hand"
  spacePressed: boolean
  canvasRef: React.RefObject<HTMLElement | null>
  setPan: React.Dispatch<React.SetStateAction<{ x: number y: number }>>
  setZoom: React.Dispatch<React.SetStateAction<number>>
  onSelect: (event: ReactMouseEvent, id: string) => void
  onClear: () => void
  onMarquee: (bounds: {
    minX: number
    minY: number
    maxX: number
    maxY: number
  }) => void
  onUpdate: (id: string, patch: Partial<OrgNode>) => void
  onAddChild: (id: string) => void
  onAddSibling: (id: string) => void
  onIcon: (id: string) => void
  onDragStart: (event: ReactMouseEvent, id: string) => void
  onTableSelect: (id: string) => void
  onTableUpdate: (table: TableData) => void
}) {
  const [panning, setPanning] = useState(false)
  const [marquee, setMarquee] = useState<{
    startX: number
    startY: number
    x: number
    y: number
  } | null>(null)
  const gesture = useRef<{
    kind: "pan" | "marquee"
    pointerId: number
    startX: number
    startY: number
    panX: number
    panY: number
  } | null>(null)
  const hidden = useMemo(() => {
    const ids = new Set<string>()
    doc.nodes
      .filter((node) => node.collapsed)
      .forEach((node) =>
        descendants(node.id, doc.nodes).forEach((item) => ids.add(item.id)),
      )
    return ids
  }, [doc.nodes])

  const beginViewportGesture = (event: React.PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.closest("input,textarea,select,button,[contenteditable]")) return
    const overElement = target.closest(".org-card,.data-table")
    if (overElement && event.button !== 1 && tool !== "hand" && !spacePressed)
      return
    const shouldMarquee =
      event.button === 0 && event.shiftKey && tool === "select" && !spacePressed
    const shouldPan =
      event.button === 1 ||
      tool === "hand" ||
      spacePressed ||
      (event.button === 0 && !event.shiftKey)
    if (!shouldPan && !shouldMarquee) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = {
      kind: shouldMarquee ? "marquee" : "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    }
    if (shouldMarquee)
      setMarquee({
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
      })
    else setPanning(true)
  }

  const moveViewportGesture = (event: React.PointerEvent<HTMLElement>) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    if (current.kind === "pan")
      setPan({
        x: current.panX + event.clientX - current.startX,
        y: current.panY + event.clientY - current.startY,
      })
    else
      setMarquee((value) =>
        value ? { ...value, x: event.clientX, y: event.clientY } : value,
      )
  }

  const endViewportGesture = (event: React.PointerEvent<HTMLElement>) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    if (current.kind === "marquee") {
      const rect = event.currentTarget.getBoundingClientRect()
      const x1 = (current.startX - rect.left - pan.x) / (zoom / 100)
      const y1 = (current.startY - rect.top - pan.y) / (zoom / 100)
      const x2 = (event.clientX - rect.left - pan.x) / (zoom / 100)
      const y2 = (event.clientY - rect.top - pan.y) / (zoom / 100)
      onMarquee({
        minX: Math.min(x1, x2),
        minY: Math.min(y1, y2),
        maxX: Math.max(x1, x2),
        maxY: Math.max(y1, y2),
      })
    }
    gesture.current = null
    setPanning(false)
    setMarquee(null)
  }

  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) {
      const rect = event.currentTarget.getBoundingClientRect()
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      const nextZoom = Math.max(
        25,
        Math.min(180, zoom * Math.exp(-event.deltaY * 0.006)),
      )
      const worldX = (pointerX - pan.x) / (zoom / 100)
      const worldY = (pointerY - pan.y) / (zoom / 100)
      setPan({
        x: pointerX - worldX * (nextZoom / 100),
        y: pointerY - worldY * (nextZoom / 100),
      })
      setZoom(Math.round(nextZoom))
    } else
      setPan((value) => ({
        x: value.x - event.deltaX,
        y: value.y - event.deltaY,
      }))
  }

  return (
    <main
      ref={canvasRef}
      className={`canvas ${doc.showGrid ? "with-grid" : ""} ${
        tool === "hand" || spacePressed ? "can-pan" : ""
      } ${panning ? "is-panning" : ""}`}
      onPointerDown={beginViewportGesture}
      onPointerMove={moveViewportGesture}
      onPointerUp={endViewportGesture}
      onPointerCancel={endViewportGesture}
      onWheel={handleWheel}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest(".org-card,.data-table"))
          onClear()
      }}
    >
      <div
        id="export-surface"
        className="canvas-surface"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})`,
        }}
      >
        {doc.showConnections && (
          <svg
            className="connections"
            width="2000"
            height="1300"
            aria-hidden="true"
          >
            {doc.nodes.map((node) => {
              if (!node.parentId || hidden.has(node.id)) return null
              const parent = doc.nodes.find((item) => item.id === node.parentId)
              if (!parent) return null
              const vertical = doc.orientation === "vertical"
              const startX = parent.x + parent.style.width / 2
              const startY = parent.y + nodeHeight(parent, doc)
              const endX = node.x + node.style.width / 2
              const endY = node.y
              const path = vertical
                ? `M ${startX} ${startY} V ${(startY + endY) / 2} H ${endX} V ${endY}`
                : `M ${parent.x + parent.style.width} ${parent.y + 55} H ${(parent.x + parent.style.width + node.x) / 2} V ${node.y + 55} H ${node.x}`
              return <path key={`${parent.id}-${node.id}`} d={path} />
            })}
          </svg>
        )}
        {doc.nodes
          .filter((node) => !hidden.has(node.id))
          .map((node) => (
            <OrgCard
              key={node.id}
              node={node}
              table={doc.tables.find(
                (table) => table.internalNodeId === node.id,
              )}
              selected={selected.includes(node.id)}
              multi={selected.length > 1}
              onSelect={onSelect}
              onUpdate={onUpdate}
              onAddChild={onAddChild}
              onAddSibling={onAddSibling}
              onIcon={onIcon}
              onDragStart={onDragStart}
            />
          ))}
        {doc.tables
          .filter((table) => !table.internalNodeId)
          .map((table) => (
            <DataTable
              key={table.id}
              table={table}
              selected={selected.includes(table.id)}
              onSelect={() => onTableSelect(table.id)}
              onUpdate={onTableUpdate}
            />
          ))}
      </div>
      {marquee && (
        <div
          className="selection-marquee"
          style={{
            left:
              Math.min(marquee.startX, marquee.x) -
              (canvasRef.current?.getBoundingClientRect().left ?? 0),
            top:
              Math.min(marquee.startY, marquee.y) -
              (canvasRef.current?.getBoundingClientRect().top ?? 0),
            width: Math.abs(marquee.x - marquee.startX),
            height: Math.abs(marquee.y - marquee.startY),
          }}
        />
      )}
    </main>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function PropertiesPanel({
  doc,
  selection,
  onDoc,
  onNode,
  onTable,
  onDelete,
  onDuplicate,
  onInsertParent,
  onAddInternalTable,
  onApplyLevel,
}: {
  doc: DocumentData
  selection: string[]
  onDoc: (patch: Partial<DocumentData>) => void
  onNode: (id: string, patch: Partial<OrgNode>) => void
  onTable: (table: TableData) => void
  onDelete: () => void
  onDuplicate: () => void
  onInsertParent: () => void
  onAddInternalTable: () => void
  onApplyLevel: (style: Partial<NodeStyle>) => void
}) {
  const node = doc.nodes.find((item) => item.id === selection[0])
  const table = doc.tables.find((item) => item.id === selection[0])
  const [section, setSection] = useState("contenuto")
  return (
    <aside className="right-panel">
      <div className="properties-heading">
        <div>
          <small>
            {selection.length > 1
              ? "Selezione multipla"
              : node
                ? "Scheda selezionata"
                : table
                  ? "Tabella selezionata"
                  : "Documento"}
          </small>
          <strong>
            {selection.length > 1
              ? `${selection.length} elementi`
              : (node?.title ?? table?.title ?? "Impostazioni")}
          </strong>
        </div>
      </div>
      {node && selection.length === 1 ? (
        <>
          <div className="property-tabs">
            {["contenuto", "stile", "struttura"].map((item) => (
              <button
                key={item}
                className={section === item ? "active" : ""}
                onClick={() => setSection(item)}
              >
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <div className="properties-content">
            {section === "contenuto" && (
              <>
                <div className="property-section">
                  <h3>Testi</h3>
                  <Field label="Titolo">
                    <input
                      value={node.title}
                      onChange={(event) =>
                        onNode(node.id, { title: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Descrizione">
                    <textarea
                      rows={3}
                      value={node.description}
                      onChange={(event) =>
                        onNode(node.id, { description: event.target.value })
                      }
                    />
                  </Field>
                </div>
                <div className="property-section">
                  <h3>Formattazione</h3>
                  <div className="format-row">
                    <select aria-label="Font">
                      <option>Inter</option>
                      <option>Arial</option>
                    </select>
                    <select aria-label="Dimensione">
                      <option>14</option>
                      <option>16</option>
                      <option>18</option>
                    </select>
                    <ToolButton
                      icon="format_bold"
                      label="Grassetto"
                      active={node.style.bold}
                      onClick={() =>
                        onNode(node.id, {
                          style: { ...node.style, bold: !node.style.bold },
                        })
                      }
                    />
                    <ToolButton
                      icon="format_italic"
                      label="Corsivo"
                      active={node.style.italic}
                      onClick={() =>
                        onNode(node.id, {
                          style: { ...node.style, italic: !node.style.italic },
                        })
                      }
                    />
                  </div>
                </div>
                <button
                  className="secondary-button full"
                  onClick={onAddInternalTable}
                >
                  <Icon name="table" /> Inserisci tabella interna
                </button>
              </>
            )}
            {section === "stile" && (
              <>
                <div className="property-section">
                  <h3>Aspetto scheda</h3>
                  <div className="color-fields">
                    <Field label="Sfondo">
                      <input
                        type="color"
                        value={node.style.background}
                        onChange={(event) =>
                          onNode(node.id, {
                            style: {
                              ...node.style,
                              background: event.target.value,
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="Bordo">
                      <input
                        type="color"
                        value={node.style.borderColor}
                        onChange={(event) =>
                          onNode(node.id, {
                            style: {
                              ...node.style,
                              borderColor: event.target.value,
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="Testo">
                      <input
                        type="color"
                        value={node.style.color}
                        onChange={(event) =>
                          onNode(node.id, {
                            style: { ...node.style, color: event.target.value },
                          })
                        }
                      />
                    </Field>
                  </div>
                  <Field label={`Raggio angoli · ${node.style.radius}px`}>
                    <input
                      type="range"
                      min="0"
                      max="32"
                      value={node.style.radius}
                      onChange={(event) =>
                        onNode(node.id, {
                          style: { ...node.style, radius: +event.target.value },
                        })
                      }
                    />
                  </Field>
                  <Field label={`Larghezza · ${node.style.width}px`}>
                    <input
                      type="range"
                      min="280"
                      max="480"
                      value={node.style.width}
                      onChange={(event) =>
                        onNode(node.id, {
                          style: { ...node.style, width: +event.target.value },
                        })
                      }
                    />
                  </Field>
                </div>
                <button
                  className="secondary-button full"
                  onClick={() => onApplyLevel(node.style)}
                >
                  Applica a tutto il livello
                </button>
                <button
                  className="ghost-button full"
                  onClick={() =>
                    onNode(node.id, { style: { ...DEFAULT_STYLE } })
                  }
                >
                  Ripristina stile
                </button>
              </>
            )}
            {section === "struttura" && (
              <div className="property-section action-list">
                <h3>Gerarchia</h3>
                <button
                  onClick={onInsertParent}
                  data-tooltip="Inserisci superiore"
                >
                  <Icon name="vertical_align_top" /> Inserisci superiore
                </button>
                <button
                  onClick={onDuplicate}
                  data-tooltip="Duplica ramo — Ctrl/Cmd + D"
                >
                  <Icon name="content_copy" /> Duplica ramo
                </button>
                <button
                  className="danger"
                  onClick={onDelete}
                  data-tooltip="Elimina scheda — Canc"
                >
                  <Icon name="delete" /> Elimina scheda
                </button>
              </div>
            )}
          </div>
        </>
      ) : table ? (
        <div className="properties-content">
          <div className="property-section">
            <h3>Tabella</h3>
            <Field label="Titolo">
              <input
                value={table.title}
                onChange={(event) =>
                  onTable({ ...table, title: event.target.value })
                }
              />
            </Field>
            <div className="stat-grid">
              <span>
                <strong>{table.rows.length}</strong> righe
              </span>
              <span>
                <strong>{table.rows[0]?.length ?? 0}</strong> colonne
              </span>
            </div>
            <button
              className="secondary-button full"
              data-tooltip="Aggiungi riga in fondo"
              onClick={() =>
                onTable({
                  ...table,
                  rows: [
                    ...table.rows,
                    Array(table.rows[0]?.length ?? 1).fill(""),
                  ],
                })
              }
            >
              <Icon name="add" /> Aggiungi riga
            </button>
            <button
              className="secondary-button full"
              data-tooltip="Aggiungi colonna a destra"
              onClick={() =>
                onTable({
                  ...table,
                  rows: table.rows.map((row) => [...row, ""]),
                })
              }
            >
              <Icon name="add" /> Aggiungi colonna
            </button>
            <button
              className="danger-button full"
              onClick={onDelete}
              data-tooltip="Elimina tabella — Canc"
            >
              <Icon name="delete" /> Elimina tabella
            </button>
          </div>
        </div>
      ) : selection.length > 1 ? (
        <div className="properties-content">
          <p className="panel-intro">
            Le modifiche verranno applicate a tutti gli elementi selezionati.
          </p>
          <button
            className="secondary-button full"
            onClick={onDuplicate}
            data-tooltip="Duplica selezione — Ctrl/Cmd + D"
          >
            <Icon name="content_copy" /> Duplica selezione
          </button>
          <button
            className="danger-button full"
            onClick={onDelete}
            data-tooltip="Elimina selezione — Canc"
          >
            <Icon name="delete" /> Elimina selezione
          </button>
        </div>
      ) : (
        <div className="properties-content">
          <div className="property-section">
            <h3>Layout</h3>
            <Field label="Modalità">
              <select
                value={doc.layoutMode}
                onChange={(event) =>
                  onDoc({
                    layoutMode: event.target
                      .value as DocumentData["layoutMode"],
                  })
                }
              >
                <option value="automatico">Automatico</option>
                <option value="libero">Libero</option>
              </select>
            </Field>
            <Field label="Orientamento">
              <select
                value={doc.orientation}
                onChange={(event) =>
                  onDoc({
                    orientation: event.target
                      .value as DocumentData["orientation"],
                  })
                }
              >
                <option value="vertical">Dall’alto in basso</option>
                <option value="horizontal">Da sinistra a destra</option>
              </select>
            </Field>
            <label className="switch-row">
              <span>Griglia puntinata</span>
              <input
                type="checkbox"
                checked={doc.showGrid}
                onChange={(event) => onDoc({ showGrid: event.target.checked })}
              />
            </label>
            <label className="switch-row">
              <span>Collegamenti</span>
              <input
                type="checkbox"
                checked={doc.showConnections}
                onChange={(event) =>
                  onDoc({ showConnections: event.target.checked })
                }
              />
            </label>
          </div>
          <div className="property-section">
            <h3>Spaziatura</h3>
            <Field label={`Fra livelli · ${doc.levelGap}px`}>
              <input
                type="range"
                min="40"
                max="220"
                value={doc.levelGap}
                onChange={(event) => onDoc({ levelGap: +event.target.value })}
              />
            </Field>
            <Field label={`Fra schede · ${doc.nodeGap}px`}>
              <input
                type="range"
                min="16"
                max="120"
                value={doc.nodeGap}
                onChange={(event) => onDoc({ nodeGap: +event.target.value })}
              />
            </Field>
          </div>
        </div>
      )}
    </aside>
  )
}

function IconPicker({
  onPick,
  onClose,
}: {
  onPick: (name: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  return (
    <div className="popover icon-picker">
      <div className="popover-heading">
        <strong>Scegli icona Material</strong>
        <ToolButton icon="close" label="Chiudi" onClick={onClose} />
      </div>
      <label className="search">
        <Icon name="search" />
        <input
          autoFocus
          placeholder="Cerca: persona, lavoro…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="icon-scroll">
        {Object.entries(iconGroups).map(([group, icons]) => {
          const filtered = icons.filter(
            (icon) =>
              icon.includes(query.toLowerCase()) ||
              group.toLowerCase().includes(query.toLowerCase()),
          )
          if (!filtered.length) return null
          return (
            <section key={group}>
              <small>{group}</small>
              <div className="icon-grid">
                {filtered.map((icon) => (
                  <button
                    key={icon}
                    aria-label={`Scegli icona ${icon}`}
                    data-tooltip={`Icona ${icon}`}
                    onClick={() => onPick(icon)}
                  >
                    <Icon name={icon} size={25} />
                  </button>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <h2>{title}</h2>
          <ToolButton icon="close" label="Chiudi" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  )
}

export default function App() {
  const initial = useMemo(() => {
    try {
      const saved = localStorage.getItem("organistudio-current")
      return saved ? JSON.parse(saved) as DocumentData : demoDocument()
    } catch {
      return demoDocument()
    }
  }, [])
  const [doc, setDoc] = useState<DocumentData>(() => autoLayout(initial))
  const [history, setHistory] = useState<DocumentData[]>([])
  const [future, setFuture] = useState<DocumentData[]>([])
  const [selection, setSelection] = useState<string[]>([])
  const [zoom, setZoom] = useState(80)
  const [pan, setPan] = useState({ x: 20, y: 10 })
  const [tool, setTool] = useState<"select" | "hand">("select")
  const [spacePressed, setSpacePressed] = useState(false)
  const [saveState, setSaveState] = useState("Salvato")
  const [iconNode, setIconNode] = useState<string | null>(null)
  const [modal, setModal] = useState<"open" | "export" | "table" | null>(null)
  const [presentation, setPresentation] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState("")
  const [exportSettings, setExportSettings] = useState({
    scale: 2 as 1 | 2 | 3,
    transparent: false,
    margin: 48,
    format: "a4" as "a4" | "a3",
    orientation: "landscape" as "portrait" | "landscape",
  })
  const importRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{
    id: string
    startX: number
    startY: number
    nodeX: number
    nodeY: number
  } | null>(null)

  const commit = useCallback(
    (next: DocumentData | ((current: DocumentData) => DocumentData)) => {
      setDoc((current) => {
        const resolved = typeof next === "function" ? next(current) : next
        setHistory((items) => [...items.slice(-39), current])
        setFuture([])
        return resolved.layoutMode === "automatico"
          ? autoLayout(resolved)
          : resolved
      })
    },
    [],
  )

  useEffect(() => {
    setSaveState("Salvataggio…")
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem("organistudio-current", JSON.stringify(doc))
        const list = JSON.parse(
          localStorage.getItem("organistudio-documents") || "[]",
        ) as DocumentData[]
        localStorage.setItem(
          "organistudio-documents",
          JSON.stringify([...list.filter((item) => item.id !== doc.id), doc]),
        )
        setSaveState("Salvato")
      } catch {
        setSaveState("Errore di salvataggio")
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [doc])

  const undo = useCallback(() => {
    const previous = history.at(-1)
    if (!previous) return
    setFuture((items) => [doc, ...items])
    setHistory((items) => items.slice(0, -1))
    setDoc(previous)
  }, [doc, history])

  const redo = useCallback(() => {
    const next = future[0]
    if (!next) return
    setHistory((items) => [...items, doc])
    setFuture((items) => items.slice(1))
    setDoc(next)
  }, [doc, future])

  const updateNode = (id: string, patch: Partial<OrgNode>) =>
    commit((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === id ? { ...node, ...patch } : node,
      ),
    }))

  const addNode = (parentId: string | null) => {
    const parent = doc.nodes.find((node) => node.id === parentId)
    const node: OrgNode = {
      id: uid(),
      parentId,
      title: "Nuova scheda",
      description: "Aggiungi una breve descrizione",
      icon: "person",
      x: parent ? parent.x : 500,
      y: parent ? parent.y + 220 : 100,
      style: { ...DEFAULT_STYLE },
    }
    commit((current) => ({ ...current, nodes: [...current.nodes, node] }))
    setSelection([node.id])
  }

  const addSibling = (id: string) =>
    addNode(doc.nodes.find((node) => node.id === id)?.parentId ?? null)

  const insertParent = () => {
    const selected = doc.nodes.find((node) => node.id === selection[0])
    if (!selected) return
    const parent: OrgNode = {
      ...selected,
      id: uid(),
      parentId: selected.parentId,
      title: "Nuovo superiore",
      description: "Livello gerarchico inserito",
      icon: "manage_accounts",
      y: selected.y - 180,
      style: { ...DEFAULT_STYLE },
    }
    commit((current) => ({
      ...current,
      nodes: [
        ...current.nodes.map((node) =>
          node.id === selected.id ? { ...node, parentId: parent.id } : node,
        ),
        parent,
      ],
    }))
    setSelection([parent.id])
  }

  const duplicate = () => {
    const source = doc.nodes.find((node) => node.id === selection[0])
    if (!source) return
    const branch = [source, ...descendants(source.id, doc.nodes)]
    const ids = new Map(branch.map((node) => [node.id, uid()]))
    const copies = branch.map((node) => ({
      ...node,
      id: ids.get(node.id)!,
      parentId:
        node.id === source.id
          ? source.parentId
          : (ids.get(node.parentId!) ?? node.parentId),
      title: node.id === source.id ? `${node.title} copia` : node.title,
      x: node.x + 30,
      y: node.y + 30,
      style: { ...node.style },
    }))
    commit((current) => ({ ...current, nodes: [...current.nodes, ...copies] }))
    setSelection([copies[0].id])
  }

  const removeSelection = () => {
    if (!selection.length) return
    const ids = new Set(selection)
    selection.forEach((id) =>
      descendants(id, doc.nodes).forEach((node) => ids.add(node.id)),
    )
    commit((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => !ids.has(node.id)),
      tables: current.tables.filter(
        (table) => !ids.has(table.id) && !ids.has(table.internalNodeId || ""),
      ),
    }))
    setSelection([])
  }

  const addTable = (internalNodeId?: string) => {
    const table: TableData = {
      id: uid(),
      title: internalNodeId ? "Dati del reparto" : "Nuova tabella",
      header: true,
      internalNodeId,
      x: 470,
      y: 500,
      rows: [
        ["Colonna 1", "Colonna 2", "Colonna 3"],
        ["", "", ""],
        ["", "", ""],
      ],
    }
    commit((current) => ({ ...current, tables: [...current.tables, table] }))
    setSelection([table.id])
    setModal(null)
  }

  const updateTable = (table: TableData) =>
    commit((current) => ({
      ...current,
      tables: current.tables.map((item) =>
        item.id === table.id ? table : item,
      ),
    }))

  const centerContent = useCallback(() => {
    const viewport = canvasRef.current
    if (!viewport) return
    const bounds = contentBounds(doc)
    const width = bounds.maxX - bounds.minX
    const height = bounds.maxY - bounds.minY
    setPan({
      x: viewport.clientWidth / 2 - (bounds.minX + width / 2) * (zoom / 100),
      y: viewport.clientHeight / 2 - (bounds.minY + height / 2) * (zoom / 100),
    })
  }, [doc, zoom])

  const fitContent = useCallback(() => {
    const viewport = canvasRef.current
    if (!viewport) return
    const bounds = contentBounds(doc)
    const width = Math.max(1, bounds.maxX - bounds.minX)
    const height = Math.max(1, bounds.maxY - bounds.minY)
    const nextZoom = Math.max(
      25,
      Math.min(
        140,
        Math.min(
          (viewport.clientWidth - 100) / width,
          (viewport.clientHeight - 100) / height,
        ) * 100,
      ),
    )
    setZoom(Math.round(nextZoom))
    setPan({
      x:
        viewport.clientWidth / 2 - (bounds.minX + width / 2) * (nextZoom / 100),
      y:
        viewport.clientHeight / 2 -
        (bounds.minY + height / 2) * (nextZoom / 100),
    })
  }, [doc])

  const zoomFromCenter = (delta: number) => {
    const viewport = canvasRef.current
    if (!viewport) return
    const pointerX = viewport.clientWidth / 2
    const pointerY = viewport.clientHeight / 2
    const nextZoom = Math.max(25, Math.min(180, zoom + delta))
    const worldX = (pointerX - pan.x) / (zoom / 100)
    const worldY = (pointerY - pan.y) / (zoom / 100)
    setPan({
      x: pointerX - worldX * (nextZoom / 100),
      y: pointerY - worldY * (nextZoom / 100),
    })
    setZoom(nextZoom)
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${doc.name.replace(/\s+/g, "-").toLowerCase()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const exportSvg = () => {
    const bounds = contentBounds(doc)
    const margin = exportSettings.margin
    const width = bounds.maxX - bounds.minX + margin * 2
    const height = bounds.maxY - bounds.minY + margin * 2
    const nodes = doc.nodes
      .map(
        (node) =>
          `<g transform="translate(${node.x},${node.y})"><rect width="${node.style.width}" height="${nodeHeight(node, doc)}" rx="${node.style.radius}" fill="${node.style.background}" stroke="${node.style.borderColor}" stroke-width="2"/><circle cx="43" cy="56" r="23" fill="white"/><g transform="translate(31 44)"><path d="${materialPath(node.icon)}" fill="#101828"/></g><text x="78" y="47" font-family="Inter,Arial" font-size="18" font-weight="700" fill="${node.style.color}">${node.title.replace(/[<&]/g, "")}</text><text x="78" y="73" font-family="Inter,Arial" font-size="14" fill="${node.style.color}">${node.description.replace(/[<&]/g, "")}</text></g>`,
      )
      .join("")
    const lines = doc.nodes
      .map((node) => {
        const parent = doc.nodes.find((item) => item.id === node.parentId)
        if (!parent) return ""
        const sx = parent.x + parent.style.width / 2,
          sy = parent.y + nodeHeight(parent, doc),
          ex = node.x + node.style.width / 2,
          ey = node.y
        return `<path d="M${sx} ${sy} V${(sy + ey) / 2} H${ex} V${ey}" fill="none" stroke="#8b97a8" stroke-width="2"/>`
      })
      .join("")
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${bounds.minX - margin} ${bounds.minY - margin} ${width} ${height}">${
      exportSettings.transparent
        ? ""
        : '<rect x="-100000" y="-100000" width="200000" height="200000" fill="white"/>'
    }${lines}${nodes}</svg>`
    const blob = new Blob([svg], { type: "image/svg+xml" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${safeFilename(doc.name)}.svg`
    link.click()
    URL.revokeObjectURL(url)
  }

  const runImageExport = async (kind: "png" | "pdf") => {
    setExporting(true)
    setExportError("")
    try {
      if (kind === "png") {
        const canvas = await renderDocumentCanvas(doc, exportSettings)
        const blob = await canvasBlob(canvas)
        downloadBlob(
          blob,
          `${safeFilename(doc.name)}-${exportSettings.scale}x.png`,
        )
      } else {
        await exportPdf(doc, exportSettings)
      }
      setModal(null)
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Esportazione non riuscita. Riprova.",
      )
    } finally {
      setExporting(false)
    }
  }

  const importFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as DocumentData
        if (
          parsed.schemaVersion !== 1 ||
          !Array.isArray(parsed.nodes) ||
          !Array.isArray(parsed.tables)
        )
          throw new Error()
        commit(parsed)
        setSelection([])
      } catch {
        window.alert(
          "Il file non è un documento OrganiStudio valido. Il documento aperto non è stato modificato.",
        )
      }
    }
    reader.readAsText(file)
    event.target.value = ""
  }

  const applyTemplate = (kind: "vuoto" | "semplice" | "tre-livelli") => {
    if (
      doc.nodes.length &&
      !window.confirm("Sostituire il documento corrente con questo modello?")
    )
      return
    let next = demoDocument()
    if (kind === "vuoto")
      next = {
        ...next,
        id: uid(),
        name: "Organigramma senza titolo",
        nodes: [],
        tables: [],
      }
    if (kind === "tre-livelli") {
      const parent = next.nodes[1]
      next.nodes.push({
        ...parent,
        id: uid(),
        parentId: parent.id,
        title: "Team operativo",
        description: "Attività e progetti",
        y: 520,
      })
    }
    commit(next)
    setSelection([])
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const editing =
        /INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable
      if (event.code === "Space" && !editing) {
        event.preventDefault()
        setSpacePressed(true)
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault()
        event.shiftKey ? redo() : undo()
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "d" &&
        !editing
      ) {
        event.preventDefault()
        duplicate()
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !editing
      ) {
        removeSelection()
      } else if (event.key === "Escape") {
        setSelection([])
        setIconNode(null)
        setModal(null)
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault()
        localStorage.setItem("organistudio-current", JSON.stringify(doc))
        setSaveState("Salvato")
      }
    }
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePressed(false)
    }
    const blur = () => setSpacePressed(false)
    window.addEventListener("keydown", keydown)
    window.addEventListener("keyup", keyup)
    window.addEventListener("blur", blur)
    return () => {
      window.removeEventListener("keydown", keydown)
      window.removeEventListener("keyup", keyup)
      window.removeEventListener("blur", blur)
    }
  })

  useEffect(() => {
    const move = (event: MouseEvent) => {
      const drag = dragRef.current
      if (!drag || doc.layoutMode !== "libero") return
      setDoc((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === drag.id
            ? {
                ...node,
                x: drag.nodeX + (event.clientX - drag.startX) / (zoom / 100),
                y: drag.nodeY + (event.clientY - drag.startY) / (zoom / 100),
              }
            : node,
        ),
      }))
    }
    const up = () => {
      if (dragRef.current) {
        setHistory((items) => [...items.slice(-39), doc])
        dragRef.current = null
      }
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
    return () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
    }
  }, [doc, zoom])

  const savedDocs = useMemo(() => {
    try {
      return JSON.parse(
        localStorage.getItem("organistudio-documents") || "[]",
      ) as DocumentData[]
    } catch {
      return []
    }
  }, [modal, saveState])

  return (
    <div className={`app-shell ${presentation ? "presentation" : ""}`}>
      {!presentation && (
        <TopBar
          doc={doc}
          saveState={saveState}
          setName={(name) => commit((current) => ({ ...current, name }))}
          onUndo={undo}
          onRedo={redo}
          canUndo={!!history.length}
          canRedo={!!future.length}
          onNew={() => applyTemplate("vuoto")}
          onOpen={() => setModal("open")}
          onImport={() => importRef.current?.click()}
          onExport={() => setModal("export")}
          onPresentation={() => setPresentation(true)}
        />
      )}
      <input
        ref={importRef}
        hidden
        type="file"
        accept=".json,application/json"
        onChange={importFile}
      />
      {!presentation && (
        <LeftPanel
          doc={doc}
          selected={selection}
          onSelect={(id) => {
            setSelection([id])
            const node = doc.nodes.find((item) => item.id === id)
            if (node)
              setPan({
                x: Math.max(20, 520 - (node.x * zoom) / 100),
                y: Math.max(10, 260 - (node.y * zoom) / 100),
              })
          }}
          onAddRoot={() => addNode(null)}
          onAddTable={() => setModal("table")}
          onTemplate={applyTemplate}
          onToggleBranch={(id) =>
            updateNode(id, {
              collapsed: !doc.nodes.find((node) => node.id === id)?.collapsed,
            })
          }
        />
      )}
      <Canvas
        doc={doc}
        selected={selection}
        zoom={zoom}
        pan={pan}
        tool={tool}
        spacePressed={spacePressed}
        canvasRef={canvasRef}
        setPan={setPan}
        setZoom={setZoom}
        onSelect={(event, id) =>
          setSelection((items) =>
            event.shiftKey
              ? items.includes(id)
                ? items.filter((item) => item !== id)
                : [...items, id]
              : [id],
          )
        }
        onClear={() => setSelection([])}
        onMarquee={(bounds) => {
          const nodeIds = doc.nodes
            .filter(
              (node) =>
                node.x < bounds.maxX &&
                node.x + node.style.width > bounds.minX &&
                node.y < bounds.maxY &&
                node.y + nodeHeight(node, doc) > bounds.minY,
            )
            .map((node) => node.id)
          const tableIds = doc.tables
            .filter((table) => !table.internalNodeId)
            .filter((table) => {
              const size = tableSize(table)
              const x = table.x ?? 440
              const y = table.y ?? 510
              return (
                x < bounds.maxX &&
                x + size.width > bounds.minX &&
                y < bounds.maxY &&
                y + size.height > bounds.minY
              )
            })
            .map((table) => table.id)
          setSelection([...nodeIds, ...tableIds])
        }}
        onUpdate={updateNode}
        onAddChild={addNode}
        onAddSibling={addSibling}
        onIcon={setIconNode}
        onDragStart={(event, id) => {
          if (tool === "hand" || spacePressed || event.button === 1) return
          const node = doc.nodes.find((item) => item.id === id)
          if (node)
            dragRef.current = {
              id,
              startX: event.clientX,
              startY: event.clientY,
              nodeX: node.x,
              nodeY: node.y,
            }
        }}
        onTableSelect={(id) => setSelection([id])}
        onTableUpdate={updateTable}
      />
      {!presentation && (
        <>
          <div className="canvas-toolbar">
            <ToolButton
              icon="arrow_selector_tool"
              label="Strumento selezione — Shift + trascina per selezionare"
              active={tool === "select"}
              onClick={() => setTool("select")}
            />
            <ToolButton
              icon="pan_tool"
              label="Sposta visuale — Spazio + trascina"
              active={tool === "hand"}
              onClick={() => setTool("hand")}
            />
            <span />
            <ToolButton
              icon="remove"
              label="Zoom indietro"
              onClick={() => zoomFromCenter(-10)}
            />
            <button className="zoom-value">{zoom}%</button>
            <ToolButton
              icon="add"
              label="Zoom avanti"
              onClick={() => zoomFromCenter(10)}
            />
            <span />
            <ToolButton
              icon="fit_screen"
              label="Adatta al contenuto"
              onClick={fitContent}
            />
            <ToolButton
              icon="filter_center_focus"
              label="Centra"
              onClick={centerContent}
            />
          </div>
          <div className="minimap">
            <div className="minimap-heading">
              <span>Mini-mappa</span>
              <Icon name="expand_more" size={17} />
            </div>
            <div className="minimap-area">
              {doc.nodes.map((node) => (
                <i
                  key={node.id}
                  style={{
                    left: node.x / 10,
                    top: node.y / 8,
                    width: Math.max(18, node.style.width / 12),
                  }}
                />
              ))}
              <b />
            </div>
          </div>
          <PropertiesPanel
            doc={doc}
            selection={selection}
            onDoc={(patch) => commit((current) => ({ ...current, ...patch }))}
            onNode={updateNode}
            onTable={updateTable}
            onDelete={removeSelection}
            onDuplicate={duplicate}
            onInsertParent={insertParent}
            onAddInternalTable={() => addTable(selection[0])}
            onApplyLevel={(style) => {
              const node = doc.nodes.find((item) => item.id === selection[0])
              if (!node) return
              const level = depthOf(node, doc.nodes)
              commit((current) => ({
                ...current,
                nodes: current.nodes.map((item) =>
                  depthOf(item, current.nodes) === level
                    ? { ...item, style: { ...item.style, ...style } }
                    : item,
                ),
              }))
            }}
          />
        </>
      )}
      {presentation && (
        <button
          className="exit-presentation editor-only"
          onClick={() => setPresentation(false)}
        >
          <Icon name="close_fullscreen" /> Esci dalla presentazione
        </button>
      )}
      {iconNode && (
        <IconPicker
          onClose={() => setIconNode(null)}
          onPick={(icon) => {
            updateNode(iconNode, { icon })
            setIconNode(null)
          }}
        />
      )}
      {modal === "table" && (
        <Modal title="Inserisci una tabella" onClose={() => setModal(null)}>
          <p className="modal-copy">
            Verrà creata una tabella 3 × 3 con riga di intestazione. Potrai
            aggiungere righe e colonne dal pannello proprietà.
          </p>
          <button className="primary-button full" onClick={() => addTable()}>
            Crea tabella 3 × 3
          </button>
        </Modal>
      )}
      {modal === "export" && (
        <Modal
          title={exporting ? "Esportazione in corso…" : "Esporta documento"}
          onClose={() => {
            if (!exporting) setModal(null)
          }}
        >
          <div className="export-settings">
            <Field label="Scala PNG">
              <select
                value={exportSettings.scale}
                disabled={exporting}
                onChange={(event) =>
                  setExportSettings((value) => ({
                    ...value,
                    scale: +event.target.value as 1 | 2 | 3,
                  }))
                }
              >
                <option value="1">1×</option>
                <option value="2">2×</option>
                <option value="3">3×</option>
              </select>
            </Field>
            <Field label="Sfondo PNG e SVG">
              <select
                value={exportSettings.transparent ? "transparent" : "white"}
                disabled={exporting}
                onChange={(event) =>
                  setExportSettings((value) => ({
                    ...value,
                    transparent: event.target.value === "transparent",
                  }))
                }
              >
                <option value="white">Bianco</option>
                <option value="transparent">Trasparente</option>
              </select>
            </Field>
            <Field label="Margine esterno">
              <select
                value={exportSettings.margin}
                disabled={exporting}
                onChange={(event) =>
                  setExportSettings((value) => ({
                    ...value,
                    margin: +event.target.value,
                  }))
                }
              >
                <option value="24">24 px</option>
                <option value="48">48 px</option>
                <option value="80">80 px</option>
              </select>
            </Field>
            <Field label="Formato PDF">
              <select
                value={exportSettings.format}
                disabled={exporting}
                onChange={(event) =>
                  setExportSettings((value) => ({
                    ...value,
                    format: event.target.value as "a4" | "a3",
                  }))
                }
              >
                <option value="a4">A4</option>
                <option value="a3">A3</option>
              </select>
            </Field>
            <Field label="Orientamento PDF">
              <select
                value={exportSettings.orientation}
                disabled={exporting}
                onChange={(event) =>
                  setExportSettings((value) => ({
                    ...value,
                    orientation: event.target.value as "portrait" | "landscape",
                  }))
                }
              >
                <option value="portrait">Verticale</option>
                <option value="landscape">Orizzontale</option>
              </select>
            </Field>
          </div>
          {exportError && (
            <div className="export-error" role="alert">
              <Icon name="error" />
              <span>{exportError}</span>
            </div>
          )}
          {exporting && (
            <div className="export-progress" role="status" aria-live="polite">
              <span className="spinner" />
              Rendering di schede, tabelle, collegamenti e icone…
            </div>
          )}
          <div className="export-options">
            <button onClick={exportSvg} disabled={exporting}>
              <Icon name="image" size={27} />
              <span>
                <strong>SVG</strong>
                <small>Vettoriale, sfondo bianco</small>
              </span>
            </button>
            <button onClick={exportJson} disabled={exporting}>
              <Icon name="data_object" size={27} />
              <span>
                <strong>JSON</strong>
                <small>Documento modificabile</small>
              </span>
            </button>
            <button onClick={() => runImageExport("pdf")} disabled={exporting}>
              <Icon name="picture_as_pdf" size={27} />
              <span>
                <strong>PDF</strong>
                <small>
                  {exportSettings.format.toUpperCase()} ·{" "}
                  {exportSettings.orientation === "landscape"
                    ? "orizzontale"
                    : "verticale"}
                </small>
              </span>
            </button>
            <button onClick={() => runImageExport("png")} disabled={exporting}>
              <Icon name="photo" size={27} />
              <span>
                <strong>PNG</strong>
                <small>
                  {exportSettings.scale}× ·{" "}
                  {exportSettings.transparent ? "trasparente" : "bianco"}
                </small>
              </span>
            </button>
          </div>
        </Modal>
      )}
      {modal === "open" && (
        <Modal title="Documenti locali" onClose={() => setModal(null)}>
          <div className="document-list">
            {savedDocs.length ? (
              savedDocs.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    commit(item)
                    setModal(null)
                  }}
                >
                  <Icon name="account_tree" />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.nodes.length} schede</small>
                  </span>
                  <Icon name="chevron_right" />
                </button>
              ))
            ) : (
              <p>Nessun documento salvato.</p>
            )}
          </div>
        </Modal>
      )}
      <TooltipLayer />
    </div>
  )
}
