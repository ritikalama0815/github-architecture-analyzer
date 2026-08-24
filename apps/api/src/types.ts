export type NodeKind =
  | 'component'
  | 'service'
  | 'module'
  | 'guard'
  | 'directive'
  | 'pipe'
  | 'interceptor'
  | 'file'
  | 'external';

export type IssueSeverity = 'critical' | 'warning' | 'info';

export type IssueType =
  | 'circular_dependency'
  | 'high_coupling'
  | 'unused_file'
  | 'god_file';

export type AnalysisStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface GraphNode {
  id: string;
  label: string;
  path: string;
  kind: NodeKind;
  fanIn: number;
  fanOut: number;
  loc: number;
  isEntry: boolean;
  isExternal: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  importPath: string;
  isCircular: boolean;
}

export interface ArchitectureIssue {
  id: string;
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  description: string;
  nodeIds: string[];
  recommendation: string;
}

export interface ProjectStats {
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
  externalCount: number;
  componentCount: number;
  serviceCount: number;
  moduleCount: number;
  totalLoc: number;
  avgFanIn: number;
  avgFanOut: number;
  circularCount: number;
  unusedCount: number;
  highCouplingCount: number;
}

export interface ArchitectureGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  issues: ArchitectureIssue[];
  stats: ProjectStats;
  healthScore: number;
}

export interface AnalysisSummary {
  id: string;
  name: string;
  sourceType: 'zip' | 'github';
  sourceUrl?: string | null;
  status: AnalysisStatus;
  healthScore?: number | null;
  errorMessage?: string | null;
  createdAt: string;
  completedAt?: string | null;
  stats?: ProjectStats | null;
}
