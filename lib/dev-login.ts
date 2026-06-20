export function devLoginEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_DEV_LOGIN === "true"
  );
}

export function defaultDevHandle() {
  return process.env.DEV_PLAYER_HANDLE ?? "local-raider";
}
