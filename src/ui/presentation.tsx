export function CodeBlock({ value }: { value: unknown }) {
  return (
    <pre className="code-block">
      <code>{JSON.stringify(value, null, 2) ?? 'No value returned'}</code>
    </pre>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge status-${status}`}>
      {status === 'success'
        ? 'Completed'
        : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function elapsed(value: number) {
  return value < 1000
    ? `${Math.round(value)} ms`
    : `${(value / 1000).toFixed(1)} s`;
}
