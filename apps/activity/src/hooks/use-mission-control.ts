import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import type { MissionControlResponse } from '../api/contract';
import type { ActivitySession } from '../api/session';

/** Mission Control changes slowly; refresh in the background at this pace. */
export const MISSION_CONTROL_REFRESH_MS = 60_000;

export interface MissionControlState {
  data: MissionControlResponse | null;
  error: ApiError | null;
  loading: boolean;
  refresh: () => void;
}

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, 'CLIENT', 'Something went wrong.');
}

export function useMissionControl(session: ActivitySession): MissionControlState {
  const [data, setData] = useState<MissionControlResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  const refresh = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    session
      .call<MissionControlResponse>('GET', '/activity/me')
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((failure: unknown) => setError(asApiError(failure)))
      .finally(() => {
        inFlight.current = false;
        setLoading(false);
      });
  }, [session]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, MISSION_CONTROL_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { data, error, loading, refresh };
}
