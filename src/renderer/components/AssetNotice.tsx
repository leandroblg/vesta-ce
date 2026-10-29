/** A refused or missing file: "“trip.mov” is larger than 100 MB and was not added." (005 FR-028, FR-029, FR-033). */
import { useEffect } from "react";
import { actions, useVesta } from "../store/store";

const SHOWN_MS = 6000;

export function AssetNotice() {
  const notice = useVesta((s) => s.assetNotice);
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => {
      actions.showAssetNotice(null);
    }, SHOWN_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [notice]);
  if (notice === null) return null;
  return (
    <div className="asset-notice" role="alert">
      {notice.text}
    </div>
  );
}
