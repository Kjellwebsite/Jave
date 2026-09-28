/** Black, red, gold: "shipped from Germany". */
export function GermanFlag({ width, height }: { width: number; height: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 flex-col overflow-hidden rounded-[2px]"
      style={{ width, height }}
    >
      <span className="flex-1 bg-[#1a1a1a]" />
      <span className="flex-1 bg-[#dd0000]" />
      <span className="flex-1 bg-[#ffce00]" />
    </span>
  );
}
