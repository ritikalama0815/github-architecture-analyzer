import {
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { ArchitectureGraph, GraphNode, NodeKind } from '@archviz/shared';
import { ThemeService } from '../core/theme.service';

cytoscape.use(fcose);

const KIND_COLORS: Record<NodeKind, string> = {
  component: '#0969da',
  service: '#1a7f37',
  module: '#8250df',
  guard: '#9a6700',
  directive: '#bf3989',
  pipe: '#0550ae',
  interceptor: '#6639ba',
  file: '#656d76',
  external: '#8b949e',
};

@Component({
  selector: 'app-architecture-graph',
  standalone: true,
  template: `
    <div class="relative h-full w-full overflow-hidden rounded-2xl" style="background: var(--graph-bg)">
      <div #host class="h-full w-full"></div>
      <div
        #minimap
        class="pointer-events-none absolute bottom-3 right-3 h-28 w-40 overflow-hidden rounded-lg border opacity-90"
        style="border-color: var(--border); background: color-mix(in srgb, var(--bg-elevated) 88%, transparent)"
      ></div>
    </div>
  `,
})
export class ArchitectureGraphComponent implements OnDestroy {
  private readonly theme = inject(ThemeService);

  readonly graph = input.required<ArchitectureGraph>();
  readonly highlightCircular = input(false);
  readonly search = input('');
  readonly kindFilter = input<NodeKind | 'all'>('all');
  readonly selectedId = input<string | null>(null);
  readonly nodeSelected = output<GraphNode | null>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly minimap = viewChild.required<ElementRef<HTMLDivElement>>('minimap');

  private cy?: Core;
  private ready = false;

  constructor() {
    afterNextRender(() => {
      this.ready = true;
      this.render();
    });

    effect(() => {
      this.graph();
      this.theme.theme();
      if (this.ready) this.render();
    });

    effect(() => {
      this.search();
      this.kindFilter();
      this.highlightCircular();
      this.selectedId();
      if (this.cy) this.applyFilters();
    });
  }

  ngOnDestroy() {
    this.cy?.destroy();
  }

  fit() {
    this.cy?.fit(undefined, 40);
  }

  private render() {
    const data = this.graph();
    const hostEl = this.host().nativeElement;
    const miniEl = this.minimap().nativeElement;
    this.cy?.destroy();

    const elements: ElementDefinition[] = [
      ...data.nodes.map((n) => ({
        data: {
          id: n.id,
          label: n.label,
          kind: n.kind,
          path: n.path,
          fanIn: n.fanIn,
          fanOut: n.fanOut,
          loc: n.loc,
          isExternal: n.isExternal,
          color: KIND_COLORS[n.kind],
        },
      })),
      ...data.edges.map((e) => ({
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          isCircular: e.isCircular,
        },
      })),
    ];

    const isDark = this.theme.theme() === 'dark';

    this.cy = cytoscape({
      container: hostEl,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'background-color': 'data(color)',
            color: isDark ? '#eef3f5' : '#1a2329',
            'font-size': 9,
            'font-family': 'IBM Plex Sans, sans-serif',
            'text-valign': 'bottom',
            'text-margin-y': 6,
            width: (ele: cytoscape.NodeSingular) =>
              18 + Math.min(28, Number(ele.data('fanIn')) + Number(ele.data('fanOut'))),
            height: (ele: cytoscape.NodeSingular) =>
              18 + Math.min(28, Number(ele.data('fanIn')) + Number(ele.data('fanOut'))),
            'border-width': 2,
            'border-color': isDark ? '#243038' : '#ffffff',
            'text-outline-width': 2,
            'text-outline-color': isDark ? '#0f1519' : '#f4f7f8',
            opacity: 1,
          } as cytoscape.Css.Node,
        },
        {
          selector: 'node[kind = "external"]',
          style: {
            shape: 'round-rectangle',
            opacity: 0.75,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.4,
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.8,
            'line-color': isDark ? '#3b4e5a' : '#9db3bd',
            'target-arrow-color': isDark ? '#3b4e5a' : '#9db3bd',
            opacity: 0.7,
          },
        },
        {
          selector: 'edge[?isCircular]',
          style: {
            width: 2.4,
            'line-color': '#e11d48',
            'target-arrow-color': '#e11d48',
            opacity: 1,
          },
        },
        {
          selector: '.dimmed',
          style: { opacity: 0.12 },
        },
        {
          selector: '.highlighted',
          style: {
            opacity: 1,
            'border-width': 4,
            'border-color': '#0969da',
            'z-index': 999,
          },
        },
      ],
      layout: {
        name: 'fcose',
        animate: true,
        animationDuration: 650,
        quality: 'default',
        randomize: true,
        nodeRepulsion: 12000,
        idealEdgeLength: 90,
        nestingFactor: 0.1,
        numIter: 1800,
        tile: true,
      } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.25,
      minZoom: 0.15,
      maxZoom: 3,
    });

    this.cy.on('tap', 'node', (evt) => {
      const id = evt.target.id();
      const node = data.nodes.find((n) => n.id === id) ?? null;
      this.nodeSelected.emit(node);
    });

    this.cy.on('tap', (evt) => {
      if (evt.target === this.cy) this.nodeSelected.emit(null);
    });

    this.drawMinimap(miniEl);
    this.applyFilters();
  }

  private applyFilters() {
    if (!this.cy) return;
    const q = this.search().trim().toLowerCase();
    const kind = this.kindFilter();
    const circularOnly = this.highlightCircular();
    const selected = this.selectedId();
    const graph = this.graph();

    const circularNodes = new Set(
      graph.edges.filter((e) => e.isCircular).flatMap((e) => [e.source, e.target]),
    );

    this.cy.batch(() => {
      this.cy!.nodes().forEach((node) => {
        const label = String(node.data('label') || '').toLowerCase();
        const path = String(node.data('path') || '').toLowerCase();
        const nodeKind = node.data('kind') as NodeKind;
        const matchesQuery = !q || label.includes(q) || path.includes(q);
        const matchesKind = kind === 'all' || nodeKind === kind;
        const matchesCircular = !circularOnly || circularNodes.has(node.id());
        const visible = matchesQuery && matchesKind && matchesCircular;
        node.style('display', visible ? 'element' : 'none');
        node.removeClass('dimmed highlighted');
      });

      this.cy!.edges().forEach((edge) => {
        const srcVisible = edge.source().style('display') !== 'none';
        const tgtVisible = edge.target().style('display') !== 'none';
        const show =
          srcVisible &&
          tgtVisible &&
          (!circularOnly || edge.data('isCircular'));
        edge.style('display', show ? 'element' : 'none');
        edge.removeClass('dimmed');
      });

      if (selected) {
        const center = this.cy!.getElementById(selected);
        if (center.nonempty()) {
          const neighborhood = center.closedNeighborhood();
          this.cy!.elements().addClass('dimmed');
          neighborhood.removeClass('dimmed').addClass('highlighted');
          center.addClass('highlighted');
        }
      }
    });
  }

  private drawMinimap(container: HTMLDivElement) {
    if (!this.cy) return;
    container.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = container.clientWidth || 160;
    canvas.height = container.clientHeight || 112;
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const nodes = this.cy.nodes(':visible');
    if (nodes.empty()) return;
    const bb = nodes.boundingBox();
    const pad = 20;
    const scale = Math.min(
      (canvas.width - pad * 2) / Math.max(bb.w, 1),
      (canvas.height - pad * 2) / Math.max(bb.h, 1),
    );

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    nodes.forEach((n) => {
      const p = n.position();
      const x = pad + (p.x - bb.x1) * scale;
      const y = pad + (p.y - bb.y1) * scale;
      ctx.fillStyle = String(n.data('color') || '#64748b');
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}
