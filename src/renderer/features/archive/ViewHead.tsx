/**
 * The Archive and Trash view header (HIG identity review, B · Hearth): the view's name and note. The
 * pressed toolbar button is the way back to the tasks, so there is no Back button here.
 */
export function ViewHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="view-head">
      {/* 007 FR-031a: focus parks here when the last entry of the view is restored or deleted. */}
      <h1 id="view-h" tabIndex={-1}>
        {title}
      </h1>
      <p>{note}</p>
    </div>
  );
}
