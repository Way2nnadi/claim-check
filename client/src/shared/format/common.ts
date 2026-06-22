const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

export function shortenId(value: string, visible = 8): string {
  if (value.length <= visible + 3) {
    return value;
  }
  return `${value.slice(0, visible)}…`;
}
