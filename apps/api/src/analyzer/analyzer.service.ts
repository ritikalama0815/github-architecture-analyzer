import { Injectable, Logger } from '@nestjs/common';
import {
  Project,
  SourceFile,
  SyntaxKind,
  Node,
} from 'ts-morph';
import { existsSync, readdirSync, statSync } from 'fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  ArchitectureGraph,
  ArchitectureIssue,
  GraphEdge,
  GraphNode,
  NodeKind,
  ProjectStats,
} from '../types';

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.angular',
  'coverage',
  '.next',
  'out',
  'tmp',
  'uploads',
  'vendor',
  '.turbo',
  'storybook-static',
]);

const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

@Injectable()
export class AnalyzerService {
  private readonly logger = new Logger(AnalyzerService.name);

  async analyze(projectRoot: string): Promise<ArchitectureGraph> {
    this.logger.log(`Analyzing ${projectRoot}`);
    const files = this.collectSourceFiles(projectRoot);
    if (files.length === 0) {
      throw new Error(
        'No TypeScript/JavaScript source files found in the project',
      );
    }

    const tsConfigPath = this.findTsConfig(projectRoot);
    const project = new Project(
      tsConfigPath
        ? {
            tsConfigFilePath: tsConfigPath,
            skipAddingFilesFromTsConfig: true,
          }
        : {
            compilerOptions: {
              allowJs: true,
              target: 99,
              module: 99,
              moduleResolution: 2,
              esModuleInterop: true,
              jsx: 2,
            },
          },
    );

    for (const file of files) {
      try {
        project.addSourceFileAtPath(file);
      } catch {
        // skip unreadable files
      }
    }

    const sourceFiles = project.getSourceFiles().filter((sf) => {
      const path = sf.getFilePath().replace(/\\/g, '/');
      return !path.includes('/node_modules/') && !path.includes('/dist/');
    });

    const pathToId = new Map<string, string>();
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const edgeKeys = new Set<string>();

    for (const sf of sourceFiles) {
      const abs = resolve(sf.getFilePath());
      const rel = this.toPosix(relative(projectRoot, abs));
      const id = `file:${rel}`;
      pathToId.set(this.normalizePath(abs), id);
      pathToId.set(this.normalizePath(rel), id);

      const kind = this.detectKind(sf, rel);
      const loc = Math.max(1, sf.getEndLineNumber());
      nodes.push({
        id,
        label: basename(rel),
        path: rel,
        kind,
        fanIn: 0,
        fanOut: 0,
        loc,
        isEntry: this.isEntryFile(rel),
        isExternal: false,
      });
    }

    const ensureExternal = (specifier: string): string => {
      const id = `ext:${specifier}`;
      if (!nodes.find((n) => n.id === id)) {
        nodes.push({
          id,
          label: specifier,
          path: specifier,
          kind: 'external',
          fanIn: 0,
          fanOut: 0,
          loc: 0,
          isEntry: false,
          isExternal: true,
        });
      }
      return id;
    };

    for (const sf of sourceFiles) {
      const abs = resolve(sf.getFilePath());
      const sourceId = pathToId.get(this.normalizePath(abs));
      if (!sourceId) continue;

      const importSpecs = this.collectImportSpecifiers(sf);
      for (const spec of importSpecs) {
        const resolved = this.resolveImport(
          projectRoot,
          dirname(abs),
          spec,
          pathToId,
        );

        let targetId: string;
        if (resolved) {
          targetId = resolved;
        } else if (this.isRelative(spec)) {
          continue;
        } else {
          const pkg = this.packageName(spec);
          targetId = ensureExternal(pkg);
        }

        const key = `${sourceId}->${targetId}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push({
          id: uuidv4(),
          source: sourceId,
          target: targetId,
          importPath: spec,
          isCircular: false,
        });
      }
    }

    this.computeDegrees(nodes, edges);
    const cycles = this.findCycles(nodes, edges);
    const circularNodeIds = new Set<string>();
    for (const cycle of cycles) {
      cycle.forEach((id) => circularNodeIds.add(id));
      for (let i = 0; i < cycle.length; i++) {
        const a = cycle[i];
        const b = cycle[(i + 1) % cycle.length];
        const edge = edges.find((e) => e.source === a && e.target === b);
        if (edge) edge.isCircular = true;
      }
    }

    const issues = this.buildIssues(nodes, edges, cycles);
    const stats = this.buildStats(nodes, edges, issues);
    const healthScore = this.computeHealthScore(stats, issues);

    return { nodes, edges, issues, stats, healthScore };
  }

  private collectSourceFiles(root: string): string[] {
    const results: string[] = [];
    const walk = (dir: string) => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.startsWith('.') && entry !== '.') continue;
        const full = join(dir, entry);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (SKIP_DIRS.has(entry)) continue;
          walk(full);
        } else if (st.isFile()) {
          const ext = extname(entry).toLowerCase();
          if (!CODE_EXTS.has(ext)) continue;
          if (entry.endsWith('.d.ts')) continue;
          if (entry.includes('.spec.') || entry.includes('.test.')) continue;
          results.push(full);
        }
      }
    };
    walk(root);
    return results.slice(0, 2500);
  }

  private findTsConfig(root: string): string | undefined {
    const candidates = [
      'tsconfig.app.json',
      'tsconfig.json',
      'apps/web/tsconfig.json',
      'src/tsconfig.app.json',
    ];
    for (const c of candidates) {
      const p = join(root, c);
      if (existsSync(p)) return p;
    }
    return undefined;
  }

  private collectImportSpecifiers(sf: SourceFile): string[] {
    const specs = new Set<string>();

    for (const decl of sf.getImportDeclarations()) {
      specs.add(decl.getModuleSpecifierValue());
    }
    for (const decl of sf.getExportDeclarations()) {
      const spec = decl.getModuleSpecifierValue();
      if (spec) specs.add(spec);
    }

    sf.forEachDescendant((node) => {
      if (node.getKind() === SyntaxKind.CallExpression) {
        const call = node.asKindOrThrow(SyntaxKind.CallExpression);
        const expr = call.getExpression();
        const text = expr.getText();
        if (text === 'require' || text === 'import') {
          const arg = call.getArguments()[0];
          if (arg && Node.isStringLiteral(arg)) {
            specs.add(arg.getLiteralText());
          }
        }
      }
    });

    return [...specs];
  }

  private resolveImport(
    projectRoot: string,
    fromDir: string,
    specifier: string,
    pathToId: Map<string, string>,
  ): string | null {
    if (!this.isRelative(specifier)) return null;

    const base = resolve(fromDir, specifier);
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.jsx`,
      `${base}.mjs`,
      join(base, 'index.ts'),
      join(base, 'index.tsx'),
      join(base, 'index.js'),
    ];

    for (const c of candidates) {
      const id = pathToId.get(this.normalizePath(c));
      if (id) return id;
      const rel = this.toPosix(relative(projectRoot, c));
      const id2 = pathToId.get(this.normalizePath(rel));
      if (id2) return id2;
    }
    return null;
  }

  private detectKind(sf: SourceFile, relPath: string): NodeKind {
    const text = sf.getFullText();
    const name = basename(relPath).toLowerCase();

    if (
      text.includes('@NgModule') ||
      name.endsWith('.module.ts') ||
      name.endsWith('.module.js')
    ) {
      return 'module';
    }
    if (
      text.includes('@Component') ||
      name.endsWith('.component.ts') ||
      name.endsWith('.component.tsx')
    ) {
      return 'component';
    }
    if (
      text.includes('@Injectable') ||
      name.endsWith('.service.ts') ||
      name.includes('.service.')
    ) {
      return 'service';
    }
    if (text.includes('@Directive') || name.endsWith('.directive.ts')) {
      return 'directive';
    }
    if (text.includes('@Pipe') || name.endsWith('.pipe.ts')) {
      return 'pipe';
    }
    if (
      text.includes('CanActivate') ||
      text.includes('CanMatch') ||
      name.endsWith('.guard.ts')
    ) {
      return 'guard';
    }
    if (
      text.includes('HttpInterceptor') ||
      name.endsWith('.interceptor.ts')
    ) {
      return 'interceptor';
    }
    return 'file';
  }

  private isEntryFile(rel: string): boolean {
    const n = rel.toLowerCase().replace(/\\/g, '/');
    return (
      n.endsWith('/main.ts') ||
      n.endsWith('/main.tsx') ||
      n.endsWith('/index.ts') ||
      n.endsWith('/index.tsx') ||
      n.endsWith('/app.config.ts') ||
      n.endsWith('/bootstrap.ts') ||
      n === 'main.ts' ||
      n === 'index.ts'
    );
  }

  private computeDegrees(nodes: GraphNode[], edges: GraphEdge[]) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const e of edges) {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      if (s) s.fanOut += 1;
      if (t) t.fanIn += 1;
    }
  }

  private findCycles(
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): string[][] {
    const adj = new Map<string, string[]>();
    for (const n of nodes) {
      if (!n.isExternal) adj.set(n.id, []);
    }
    for (const e of edges) {
      if (adj.has(e.source) && adj.has(e.target)) {
        adj.get(e.source)!.push(e.target);
      }
    }

    const cycles: string[][] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const stack: string[] = [];
    const seenCycleKeys = new Set<string>();

    const dfs = (node: string) => {
      visiting.add(node);
      stack.push(node);
      for (const next of adj.get(node) ?? []) {
        if (visiting.has(next)) {
          const idx = stack.indexOf(next);
          if (idx >= 0) {
            const cycle = stack.slice(idx);
            const key = [...cycle].sort().join('|');
            if (!seenCycleKeys.has(key) && cycle.length > 1) {
              seenCycleKeys.add(key);
              cycles.push(cycle);
            }
          }
        } else if (!visited.has(next)) {
          dfs(next);
        }
      }
      stack.pop();
      visiting.delete(node);
      visited.add(node);
    };

    for (const id of adj.keys()) {
      if (!visited.has(id)) dfs(id);
    }
    return cycles.slice(0, 50);
  }

  private buildIssues(
    nodes: GraphNode[],
    edges: GraphEdge[],
    cycles: string[][],
  ): ArchitectureIssue[] {
    const issues: ArchitectureIssue[] = [];
    const byId = new Map(nodes.map((n) => [n.id, n]));

    cycles.forEach((cycle, i) => {
      const labels = cycle.map((id) => byId.get(id)?.label ?? id);
      issues.push({
        id: `cycle-${i}`,
        type: 'circular_dependency',
        severity: 'critical',
        title: `Circular dependency (${cycle.length} nodes)`,
        description: labels.join(' → ') + ` → ${labels[0]}`,
        nodeIds: cycle,
        recommendation:
          'Break the cycle by extracting a shared module, introducing an interface/token, or inverting a dependency.',
      });
    });

    const internal = nodes.filter((n) => !n.isExternal);
    const fanOutThreshold = Math.max(
      8,
      Math.ceil(this.percentile(internal.map((n) => n.fanOut), 0.9)),
    );
    const fanInThreshold = Math.max(
      8,
      Math.ceil(this.percentile(internal.map((n) => n.fanIn), 0.9)),
    );

    for (const n of internal) {
      if (n.fanOut >= fanOutThreshold || n.fanIn >= fanInThreshold) {
        issues.push({
          id: `couple-${n.id}`,
          type: 'high_coupling',
          severity: n.fanOut >= fanOutThreshold * 1.5 ? 'critical' : 'warning',
          title: `Highly coupled: ${n.label}`,
          description: `${n.path} has fan-in=${n.fanIn}, fan-out=${n.fanOut}`,
          nodeIds: [n.id],
          recommendation:
            'Split responsibilities, reduce direct imports, or introduce a facade/barrel carefully.',
        });
      }
      if (n.loc >= 400) {
        issues.push({
          id: `god-${n.id}`,
          type: 'god_file',
          severity: n.loc >= 800 ? 'critical' : 'warning',
          title: `Large file: ${n.label}`,
          description: `${n.path} has ~${n.loc} lines`,
          nodeIds: [n.id],
          recommendation:
            'Extract smaller components/services and isolate side effects.',
        });
      }
    }

    const referenced = new Set(edges.map((e) => e.target));
    for (const n of internal) {
      if (n.isEntry) continue;
      if (n.fanIn === 0 && !referenced.has(n.id)) {
        // also skip angular module/bootstrap-ish names lightly already handled by isEntry
        if (
          n.path.includes('/environments/') ||
          n.label.startsWith('polyfills')
        ) {
          continue;
        }
        issues.push({
          id: `unused-${n.id}`,
          type: 'unused_file',
          severity: 'info',
          title: `Possibly unused: ${n.label}`,
          description: `${n.path} is not imported by other analyzed files`,
          nodeIds: [n.id],
          recommendation:
            'Confirm it is not a lazy route entry or test helper, then remove or wire it up.',
        });
      }
    }

    return issues.slice(0, 200);
  }

  private buildStats(
    nodes: GraphNode[],
    edges: GraphEdge[],
    issues: ArchitectureIssue[],
  ): ProjectStats {
    const internal = nodes.filter((n) => !n.isExternal);
    const avg = (arr: number[]) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    return {
      fileCount: internal.length,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      externalCount: nodes.filter((n) => n.isExternal).length,
      componentCount: internal.filter((n) => n.kind === 'component').length,
      serviceCount: internal.filter((n) => n.kind === 'service').length,
      moduleCount: internal.filter((n) => n.kind === 'module').length,
      totalLoc: internal.reduce((s, n) => s + n.loc, 0),
      avgFanIn: Number(avg(internal.map((n) => n.fanIn)).toFixed(2)),
      avgFanOut: Number(avg(internal.map((n) => n.fanOut)).toFixed(2)),
      circularCount: issues.filter((i) => i.type === 'circular_dependency')
        .length,
      unusedCount: issues.filter((i) => i.type === 'unused_file').length,
      highCouplingCount: issues.filter((i) => i.type === 'high_coupling')
        .length,
    };
  }

  private computeHealthScore(
    stats: ProjectStats,
    issues: ArchitectureIssue[],
  ): number {
    let score = 100;
    score -= stats.circularCount * 12;
    score -= stats.highCouplingCount * 4;
    score -= Math.min(20, stats.unusedCount * 1);
    score -= issues.filter((i) => i.type === 'god_file').length * 3;
    score -= issues.filter((i) => i.severity === 'critical').length * 2;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private percentile(values: number[], p: number): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(
      sorted.length - 1,
      Math.floor(sorted.length * p),
    );
    return sorted[idx];
  }

  private isRelative(spec: string): boolean {
    return spec.startsWith('./') || spec.startsWith('../');
  }

  private packageName(spec: string): string {
    if (spec.startsWith('@')) {
      const parts = spec.split('/');
      return parts.slice(0, 2).join('/');
    }
    return spec.split('/')[0];
  }

  private normalizePath(p: string): string {
    return resolve(p).replace(/\\/g, '/').toLowerCase();
  }

  private toPosix(p: string): string {
    return p.split(sep).join('/');
  }
}
