export type Segment = {
  label: string;
  fullPath: string;
  isHome: boolean;
  /** Virtual "This PC" root above Windows drive letters. Not a real path. */
  isComputerRoot: boolean;
};

const WINDOWS_DRIVE = /^([A-Za-z]:)(.*)$/;

function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

export const COMPUTER_ROOT_PATH = "";

export function segmentsFromCwd(cwd: string, home: string | null): Segment[] {
  const normCwd = normalize(cwd);
  const normHome = home !== null ? normalize(home) : null;

  const usingHome =
    normHome !== null &&
    (normCwd === normHome || normCwd.startsWith(normHome + "/"));

  let segments: Segment[] = [];
  let tail: string;

  if (usingHome) {
    segments = [
      { label: "~", fullPath: normHome!, isHome: true, isComputerRoot: false },
    ];
    tail = normCwd.slice(normHome!.length).replace(/^\//, "");
  } else {
    const driveMatch = WINDOWS_DRIVE.exec(normCwd);
    if (driveMatch) {
      const drive = driveMatch[1];
      segments = [
        {
          label: "",
          fullPath: COMPUTER_ROOT_PATH,
          isHome: false,
          isComputerRoot: true,
        },
        {
          label: drive,
          fullPath: drive + "/",
          isHome: false,
          isComputerRoot: false,
        },
      ];
      tail = driveMatch[2].replace(/^\//, "");
    } else {
      segments = [
        { label: "/", fullPath: "/", isHome: false, isComputerRoot: false },
      ];
      tail = normCwd.replace(/^\//, "");
    }
  }

  const parts = tail === "" ? [] : tail.split("/").filter(Boolean);
  let acc = segments[segments.length - 1].fullPath;
  for (const part of parts) {
    acc = acc.endsWith("/") ? acc + part : acc + "/" + part;
    segments.push({
      label: part,
      fullPath: acc,
      isHome: false,
      isComputerRoot: false,
    });
  }
  return segments;
}
