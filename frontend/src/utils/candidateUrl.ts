/**
 * Compute the next URL search params to keep the open candidate profile in the
 * address bar (shareable `?entity=ID`) WITHOUT fighting a pending deep-link load.
 *
 * - `curId`  = id of the currently open profile (selectedCard?.id ?? null)
 * - `prevId` = id from the previous render (a ref), used to tell a genuine close
 *              (selected -> null) apart from a deep-link-pending null (null -> null).
 *
 * Returns the next URLSearchParams, or `null` when nothing should change
 * (the null return is the loop guard — the caller skips setSearchParams).
 */
export function computeEntityParamUpdate(
  current: URLSearchParams,
  curId: number | null,
  prevId: number | null,
): URLSearchParams | null {
  const have = current.get('entity');

  if (curId != null) {
    // Opened or switched profile.
    if (have === String(curId)) return null; // already in sync
    const next = new URLSearchParams(current);
    next.set('entity', String(curId));
    return next;
  }

  // curId == null. Only clear on a GENUINE close (we had a selection last render).
  // A null->null transition means a deep-link select is still pending: leave it.
  if (prevId != null && (current.has('entity') || current.has('edit') || current.has('tab'))) {
    const next = new URLSearchParams(current);
    next.delete('entity');
    next.delete('edit');
    next.delete('tab');
    return next;
  }

  return null;
}
