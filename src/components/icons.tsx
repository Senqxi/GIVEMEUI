import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  size?: number;
};

type IconName =
  | "alert-triangle"
  | "bot-off"
  | "check-circle"
  | "circle-stop"
  | "clock"
  | "file-json"
  | "history"
  | "library"
  | "play"
  | "rotate"
  | "search"
  | "settings"
  | "sparkles"
  | "terminal"
  | "wrench";

function Icon({ name, size = 18, ...props }: IconProps & { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {iconPaths[name]}
    </svg>
  );
}

const iconPaths: Record<IconName, JSX.Element> = {
  "alert-triangle": (
    <>
      <path d="M12 3 2.8 20h18.4L12 3Z" />
      <path d="M12 9v5" />
      <path d="M12 17h.01" />
    </>
  ),
  "bot-off": (
    <>
      <path d="M4 4 20 20" />
      <path d="M9 7h6" />
      <path d="M12 3v4" />
      <rect height="10" rx="3" width="14" x="5" y="8" />
      <path d="M9 13h.01" />
      <path d="M15 13h.01" />
      <path d="M8 18v2" />
      <path d="M16 18v2" />
    </>
  ),
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </>
  ),
  "circle-stop": (
    <>
      <circle cx="12" cy="12" r="9" />
      <rect height="7" rx="1" width="7" x="8.5" y="8.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  "file-json": (
    <>
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v5h5" />
      <path d="M10 12a2 2 0 0 0 0 4" />
      <path d="M14 12a2 2 0 0 1 0 4" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 8v5l3 2" />
    </>
  ),
  library: (
    <>
      <path d="M4 19V5" />
      <path d="M8 19V5" />
      <path d="M12 19V5" />
      <path d="m16 6 4 12" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7V5Z" />,
  rotate: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v6h-6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <path d="M4 17h2" />
      <path d="M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z" />
      <path d="m5 15 .8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15Z" />
      <path d="m19 13 .6 1.4L21 15l-1.4.6L19 17l-.6-1.4L17 15l1.4-.6L19 13Z" />
    </>
  ),
  terminal: (
    <>
      <path d="m4 7 5 5-5 5" />
      <path d="M11 17h9" />
    </>
  ),
  wrench: (
    <>
      <path d="M14.5 5.5a4 4 0 0 0 4.8 4.8L10 19.6a2.4 2.4 0 0 1-3.4-3.4l9.3-9.3a4 4 0 0 0-1.4-1.4Z" />
    </>
  )
};

export function AlertTriangle(props: IconProps) {
  return <Icon name="alert-triangle" {...props} />;
}

export function BotOff(props: IconProps) {
  return <Icon name="bot-off" {...props} />;
}

export function CheckCircle2(props: IconProps) {
  return <Icon name="check-circle" {...props} />;
}

export function CircleStop(props: IconProps) {
  return <Icon name="circle-stop" {...props} />;
}

export function Clock3(props: IconProps) {
  return <Icon name="clock" {...props} />;
}

export function FileJson2(props: IconProps) {
  return <Icon name="file-json" {...props} />;
}

export function History(props: IconProps) {
  return <Icon name="history" {...props} />;
}

export function Library(props: IconProps) {
  return <Icon name="library" {...props} />;
}

export function Play(props: IconProps) {
  return <Icon name="play" {...props} />;
}

export function RotateCcw(props: IconProps) {
  return <Icon name="rotate" {...props} />;
}

export function Search(props: IconProps) {
  return <Icon name="search" {...props} />;
}

export function Settings2(props: IconProps) {
  return <Icon name="settings" {...props} />;
}

export function Sparkles(props: IconProps) {
  return <Icon name="sparkles" {...props} />;
}

export function Terminal(props: IconProps) {
  return <Icon name="terminal" {...props} />;
}

export function Wrench(props: IconProps) {
  return <Icon name="wrench" {...props} />;
}
