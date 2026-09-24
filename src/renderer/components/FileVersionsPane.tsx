import React, { useEffect, useState, useCallback } from 'react';
import { History, RefreshCw, ArrowLeftRight, Undo2, X, ChevronDown, ChevronUp } from 'lucide-react';
import DiffViewer from './DiffViewer';
import { writeFileContent } from '../api/fileSystem';

interface VersionEntry {
    id: string;
    ts: number;
    origin: 'manual' | 'autosave' | 'rollback';
    bytes: number;
}

interface FileVersionsPaneProps {
    filePath: string;
    currentPath?: string;
}

const formatTs = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString();
};

const originBadgeClass = (origin: string) => {
    switch (origin) {
        case 'manual': return 'bg-blue-500/20 text-blue-300';
        case 'autosave': return 'bg-yellow-500/20 text-yellow-300';
        case 'rollback': return 'bg-purple-500/20 text-purple-300';
        default: return 'bg-gray-500/20 text-gray-300';
    }
};

const FileVersionsPane: React.FC<FileVersionsPaneProps> = ({ filePath, currentPath }) => {
    const [versions, setVersions] = useState<VersionEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedLeft, setSelectedLeft] = useState<string | null>(null);
    const [selectedRight, setSelectedRight] = useState<string | null>(null);
    const [leftContent, setLeftContent] = useState<string>('');
    const [rightContent, setRightContent] = useState<string>('');
    const [detailOpen, setDetailOpen] = useState(false);
    const [detailId, setDetailId] = useState<string | null>(null);
    const [detailContent, setDetailContent] = useState<string>('');

    const api = (window as any).api;

    const loadVersions = useCallback(async () => {
        if (!filePath) return;
        setLoading(true);
        setError(null);
        try {
            const result = await api?.listVersions?.({ filePath, limit: 100 });
            setVersions(result?.versions || []);
        } catch (err: any) {
            setError(err.message || 'Failed to load versions');
        } finally {
            setLoading(false);
        }
    }, [filePath, api]);

    useEffect(() => {
        loadVersions();
    }, [loadVersions]);

    const readVersion = async (id: string) => {
        const result = await api?.readVersion?.({ filePath, id });
        return result?.content ?? '';
    };

    const handleSelect = async (id: string) => {
        setDetailId(id);
        setDetailContent(await readVersion(id));
        setDetailOpen(true);
    };

    const handleDiffSelect = async (id: string, side: 'left' | 'right') => {
        const content = await readVersion(id);
        if (side === 'left') {
            setSelectedLeft(id);
            setLeftContent(content);
        } else {
            setSelectedRight(id);
            setRightContent(content);
        }
    };

    const handleRollback = async (id: string) => {
        if (!filePath) return;
        const content = await readVersion(id);
        await writeFileContent(filePath, content, 'rollback');
        // Signal open editor panes for this file to reload
        window.dispatchEvent(new CustomEvent('file-versions-rollback', { detail: { filePath } }));
        await loadVersions();
    };

    return (
        <div className="flex-1 flex flex-col min-h-0 theme-bg-secondary text-sm">
            <div className="flex items-center justify-between px-3 py-2 border-b theme-border">
                <div className="flex items-center gap-2">
                    <History size={14} className="text-blue-400" />
                    <span className="font-medium">Version History</span>
                    <span className="text-xs theme-text-muted">{versions.length} snapshots</span>
                </div>
                <button
                    onClick={loadVersions}
                    className="p-1 rounded theme-button theme-hover"
                    title="Refresh"
                >
                    <RefreshCw size={12} />
                </button>
            </div>

            {loading && <div className="p-3 text-xs theme-text-muted">Loading versions...</div>}
            {error && <div className="p-3 text-xs text-red-400">{error}</div>}

            <div className="flex-1 flex min-h-0 overflow-hidden">
                <div className="w-72 border-r theme-border overflow-y-auto">
                    {versions.slice().reverse().map((v) => (
                        <div
                            key={v.id}
                            className={`px-3 py-2 border-b theme-border cursor-pointer hover:bg-white/5 ${selectedLeft === v.id || selectedRight === v.id ? 'bg-white/10' : ''}`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${originBadgeClass(v.origin)}`}>{v.origin}</span>
                                    <span className="text-xs font-mono">{formatTs(v.ts)}</span>
                                </div>
                                <span className="text-[10px] theme-text-muted">{(v.bytes / 1024).toFixed(1)}KB</span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-1">
                                <button
                                    onClick={() => handleSelect(v.id)}
                                    className="px-2 py-0.5 text-[10px] rounded bg-white/10 hover:bg-white/20"
                                >
                                    View
                                </button>
                                <button
                                    onClick={() => handleRollback(v.id)}
                                    className="px-2 py-0.5 text-[10px] rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30"
                                >
                                    <Undo2 size={10} className="inline mr-1" /> Rollback
                                </button>
                                <button
                                    onClick={() => handleDiffSelect(v.id, 'left')}
                                    className={`px-2 py-0.5 text-[10px] rounded ${selectedLeft === v.id ? 'bg-green-500/30 text-green-200' : 'bg-white/10 hover:bg-white/20'}`}
                                >
                                    Left
                                </button>
                                <button
                                    onClick={() => handleDiffSelect(v.id, 'right')}
                                    className={`px-2 py-0.5 text-[10px] rounded ${selectedRight === v.id ? 'bg-green-500/30 text-green-200' : 'bg-white/10 hover:bg-white/20'}`}
                                >
                                    Right
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    {detailOpen && detailId && (
                        <div className="flex-1 flex flex-col min-h-0 border-b theme-border">
                            <div className="flex items-center justify-between px-3 py-1.5 border-b theme-border bg-black/20">
                                <span className="text-xs font-medium">Snapshot {formatTs(Number(detailId.split('-')[0]))}</span>
                                <button onClick={() => setDetailOpen(false)} className="p-0.5 theme-hover rounded"><X size={12} /></button>
                            </div>
                            <pre className="flex-1 overflow-auto p-3 text-xs font-mono whitespace-pre-wrap">{detailContent}</pre>
                        </div>
                    )}

                    {selectedLeft && selectedRight && (
                        <div className="flex-1 flex flex-col min-h-0">
                            <div className="flex items-center gap-2 px-3 py-1.5 border-b theme-border bg-black/20">
                                <ArrowLeftRight size={12} />
                                <span className="text-xs">Diff</span>
                                <span className="text-[10px] theme-text-muted">{formatTs(Number(selectedLeft.split('-')[0]))} ↔ {formatTs(Number(selectedRight.split('-')[0]))}</span>
                            </div>
                            <DiffViewer
                                filePath={filePath}
                                currentPath={currentPath}
                                leftContent={leftContent}
                                rightContent={rightContent}
                                leftLabel={formatTs(Number(selectedLeft.split('-')[0]))}
                                rightLabel={formatTs(Number(selectedRight.split('-')[0]))}
                            />
                        </div>
                    )}

                    {!detailOpen && !(selectedLeft && selectedRight) && (
                        <div className="flex-1 flex items-center justify-center theme-text-muted text-xs">
                            Select a version to view, or pick two versions to diff.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FileVersionsPane;
