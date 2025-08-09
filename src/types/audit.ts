export enum AuditLevel {
  BASIC = 'BASIC',
  STANDARD = 'STANDARD',
  COMPREHENSIVE = 'COMPREHENSIVE',
  ENTERPRISE = 'ENTERPRISE'
}

export interface SecurityScanResult {
  timestamp: Date;
  vulnerabilities: string[];
  warnings: string[];
  passed: string[];
  score: number;
}

export interface CodeAnalysisResult {
  timestamp: Date;
  codeQuality: {
    complexity: 'LOW' | 'MEDIUM' | 'HIGH';
    maintainability: 'LOW' | 'MEDIUM' | 'HIGH';
    readability: 'LOW' | 'MEDIUM' | 'HIGH';
    documentation: 'LOW' | 'MEDIUM' | 'HIGH';
  };
  bestPractices: {
    solanaPatterns: boolean;
    errorHandling: boolean;
    inputValidation: boolean;
    gasOptimization: boolean;
  };
  issues: string[];
  score: number;
}

export interface AuditReport {
  timestamp: Date;
  programId: string;
  auditLevel: AuditLevel;
  securityScan: SecurityScanResult;
  codeAnalysis: CodeAnalysisResult;
  blockchainAnalysis: any;
  recommendations: string[];
  overallScore: number;
  status: 'PENDING' | 'PASSED' | 'PASSED_WITH_WARNINGS' | 'FAILED_WITH_CRITICAL_ISSUES' | 'FAILED';
} 