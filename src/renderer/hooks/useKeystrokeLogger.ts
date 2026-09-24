import { useRef, useCallback, useEffect } from 'react';

interface PaneBuffer {
    text: string;
    paneType: string;
    paneDetail: string;
    firstTs: number;
    lastTs: number;
    armTimer: ReturnType<typeof setTimeout> | null;
}

const SAFETY_TIMEOUT_MS = 8000;
const MAX_STORED_TEXT = 5000;

export function useKeystrokeLogger() {
    const sessionIdRef = useRef(`session_${Date.now()}`);
    const enabledRef = useRef(() => {
        try {
            return localStorage.getItem('incognide_activityTrackingEnabled') !== 'false';
        } catch { return true; }
    });

    const enabledValue = enabledRef.current();
    const buffersRef = useRef<Record<string, PaneBuffer>>({});

    const flushPane = useCallback(async (paneDetail: string) => {
        const buffer = buffersRef.current[paneDetail];
        if (!buffer || buffer.text.length === 0) return;

        if (buffer.armTimer) {
            clearTimeout(buffer.armTimer);
            buffer.armTimer = null;
        }

        const text = buffer.text.length > MAX_STORED_TEXT ? buffer.text.slice(-MAX_STORED_TEXT) : buffer.text;
        const paneType = buffer.paneType;
        const firstTs = buffer.firstTs;
        const lastTs = buffer.lastTs;
        delete buffersRef.current[paneDetail];

        if (!enabledValue) return;

        try {
            const sessionId = sessionIdRef.current;
            await (window as any).api?.logActivityBatch?.([{
                type: 'keystroke_batch',
                data: {
                    text,
                    paneType,
                    paneDetail,
                    firstTs,
                    lastTs,
                },
                sessionId,
            }]);
        } catch (err) {
            console.error('[useKeystrokeLogger] batch flush failed:', err);
        }
    }, [enabledValue]);

    const flushAll = useCallback(async () => {
        await Promise.all(Object.keys(buffersRef.current).map(flushPane));
    }, [flushPane]);

    const appendKeystrokes = useCallback((paneType: string, paneDetail: string, text: string) => {
        if (!enabledValue || !text) return;
        const now = Date.now();
        const buffer = buffersRef.current[paneDetail] || {
            text: '',
            paneType,
            paneDetail,
            firstTs: now,
            lastTs: now,
            armTimer: null,
        };
        buffer.text += text;
        if (buffer.text.length > MAX_STORED_TEXT) {
            buffer.text = buffer.text.slice(-MAX_STORED_TEXT);
        }
        buffer.lastTs = now;
        if (!buffer.armTimer) {
            buffer.armTimer = setTimeout(() => {
                flushPane(paneDetail);
            }, SAFETY_TIMEOUT_MS);
        }
        buffersRef.current[paneDetail] = buffer;
    }, [enabledValue, flushPane]);

    const flushPaneByDetail = useCallback((paneType: string, paneDetail: string) => {
        flushPane(paneDetail);
    }, [flushPane]);

    const armPane = useCallback((paneType: string, paneDetail: string) => {
        if (!enabledValue) return;
        if (!buffersRef.current[paneDetail]) {
            buffersRef.current[paneDetail] = {
                text: '',
                paneType,
                paneDetail,
                firstTs: Date.now(),
                lastTs: Date.now(),
                armTimer: null,
            };
        }
    }, [enabledValue]);

    const disarmPane = useCallback((paneDetail: string) => {
        const buffer = buffersRef.current[paneDetail];
        if (buffer?.armTimer) {
            clearTimeout(buffer.armTimer);
            buffer.armTimer = null;
        }
    }, []);

    useEffect(() => {
        const handleBeforeUnload = () => {
            flushAll();
        };
        const handleWindowBlur = () => {
            flushAll();
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        window.addEventListener('blur', handleWindowBlur);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            window.removeEventListener('blur', handleWindowBlur);
        };
    }, [flushAll]);

    return {
        appendKeystrokes,
        flushPane: flushPaneByDetail,
        flushAll,
        armPane,
        disarmPane,
        sessionId: sessionIdRef.current,
    };
}
