import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n/zh";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  ArrowDown01Icon,
  ComputerIcon,
  Folder01Icon,
  Home03Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { type Segment, segmentsFromCwd } from "./lib/pathUtils";

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  onCd: (path: string) => void;
  /** A locked terminal tab pins its cwd: no segment may navigate. */
  locked?: boolean;
};

function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (i <= 0) return "/";
  return path.slice(0, i);
}

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i === -1 ? path : path.slice(i + 1);
}

function segmentLabel(segment: Segment): string {
  if (segment.isComputerRoot) return t("statusbar.thisPc");
  if (segment.isHome) return "Home";
  return segment.label;
}

export function CwdBreadcrumb({
  cwd,
  filePath,
  home,
  onCd,
  locked = false,
}: Props) {
  // File mode: dir segments navigate; filename is the terminal leaf.
  if (filePath) {
    const dir = dirname(filePath);
    const name = basename(filePath);
    const segments = segmentsFromCwd(dir, home);
    const first = segments[0];
    const middle = segments.slice(1);
    return (
      <Breadcrumb>
        <BreadcrumbList className="gap-1 text-xs sm:gap-1.5">
          {first ? (
            <BreadcrumbSegment segment={first} onCd={onCd} locked={locked} />
          ) : null}
          {middle.length > 0 ? (
            <CollapsedSegments
              segments={middle}
              onCd={onCd}
              locked={locked}
            />
          ) : null}
          {middle.map((s) => (
            <span key={s.fullPath} className="contents max-md:hidden">
              <BreadcrumbSegment segment={s} onCd={onCd} locked={locked} />
            </span>
          ))}
          <BreadcrumbItem>
            <BreadcrumbPage className="text-foreground">{name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  if (!cwd) {
    return (
      <span className="text-xs text-muted-foreground/70">no directory</span>
    );
  }

  const segments = segmentsFromCwd(cwd, home);
  const current = segments[segments.length - 1];
  const parents = segments.slice(0, -1);

  const firstParent = parents[0];
  const middleParents = parents.slice(1);
  return (
    <Breadcrumb>
      <BreadcrumbList className="gap-1 text-xs sm:gap-1.5">
        {firstParent ? (
          <BreadcrumbSegment
            segment={firstParent}
            onCd={onCd}
            locked={locked}
          />
        ) : null}
        {middleParents.length > 0 ? (
          <CollapsedSegments
            segments={middleParents}
            onCd={onCd}
            locked={locked}
          />
        ) : null}
        {middleParents.map((s) => (
          <span key={s.fullPath} className="contents max-md:hidden">
            <BreadcrumbSegment segment={s} onCd={onCd} locked={locked} />
          </span>
        ))}
        <BreadcrumbItem>
          <CurrentSegmentDropdown
            segment={current}
            onCd={onCd}
            locked={locked}
          />
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function BreadcrumbSegment({
  segment,
  onCd,
  locked = false,
}: {
  segment: Segment;
  onCd: (p: string) => void;
  locked?: boolean;
}) {
  const label = segmentLabel(segment);
  // The virtual "This PC" root is not a real directory: clicking it opens a
  // drive list instead of cd'ing to it (the shell has no such path).
  if (segment.isComputerRoot) {
    return <ComputerRootSegment label={label} onCd={onCd} locked={locked} />;
  }
  if (locked) {
    return (
      <>
        <BreadcrumbItem>
          <Badge
            variant="outline"
            className="gap-1 cursor-default text-muted-foreground/60"
          >
            {segment.isHome ? (
              <HugeiconsIcon
                icon={Home03Icon}
                className="size-3"
                strokeWidth={1.75}
              />
            ) : null}
            {label}
          </Badge>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="[&>svg]:size-3" />
      </>
    );
  }
  return (
    <>
      <BreadcrumbItem>
        <BreadcrumbLink asChild>
          <button
            type="button"
            onClick={() => onCd(segment.fullPath)}
            className="cursor-pointer"
          >
            <Badge
              variant="outline"
              className="gap-1 text-muted-foreground hover:text-foreground"
            >
              {segment.isHome ? (
                <HugeiconsIcon
                  icon={Home03Icon}
                  className="size-3"
                  strokeWidth={1.75}
                />
              ) : null}
              {label}
            </Badge>
          </button>
        </BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator className="[&>svg]:size-3" />
    </>
  );
}

function ComputerRootSegment({
  label,
  onCd,
  locked = false,
}: {
  label: string;
  onCd: (p: string) => void;
  locked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [drives, setDrives] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || drives !== null) return;
    invoke<string[]>("fs_list_drives")
      .then(setDrives)
      .catch((e) => {
        setError(String(e));
        setDrives([]);
      });
  }, [open, drives]);

  if (locked) {
    return (
      <>
        <BreadcrumbItem>
          <Badge
            variant="outline"
            className="gap-1 cursor-default text-muted-foreground/60"
          >
            <HugeiconsIcon
              icon={ComputerIcon}
              className="size-3"
              strokeWidth={1.75}
            />
            {label}
          </Badge>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="[&>svg]:size-3" />
      </>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <BreadcrumbItem>
        <BreadcrumbLink asChild>
          <DropdownMenuTrigger asChild>
            <button type="button" className="cursor-pointer outline-none">
              <Badge
                variant="outline"
                className="gap-1 text-muted-foreground hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={ComputerIcon}
                  className="size-3"
                  strokeWidth={1.75}
                />
                {label}
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  className="size-3 opacity-70"
                  strokeWidth={2}
                />
              </Badge>
            </button>
          </DropdownMenuTrigger>
        </BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator className="[&>svg]:size-3" />
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {drives === null ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("statusbar.loading")}
          </div>
        ) : drives.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {error ?? t("statusbar.noSubfolders")}
          </div>
        ) : (
          drives.map((drive) => (
            <DropdownMenuItem key={drive} onSelect={() => onCd(drive)}>
              <HugeiconsIcon
                icon={Folder01Icon}
                className="size-3.5 text-muted-foreground"
                strokeWidth={1.75}
              />
              {drive}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CurrentSegmentDropdown({
  segment,
  onCd,
  locked = false,
}: {
  segment: Segment;
  onCd: (p: string) => void;
  locked?: boolean;
}) {
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { label, path } = segment.isComputerRoot
    ? { label: t("statusbar.thisPc"), path: null }
    : { label: segmentLabel(segment), path: segment.fullPath };

  const load = useCallback(async () => {
    setError(null);
    try {
      const dirs =
        path === null
          ? await invoke<string[]>("fs_list_drives")
          : await invoke<string[]>("list_subdirs", {
              path,
              showHidden,
              workspace: currentWorkspaceEnv(),
            });
      setChildren(dirs);
    } catch (e) {
      setError(String(e));
      setChildren([]);
    }
  }, [path, showHidden]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (locked) {
    return (
      <BreadcrumbPage className="flex cursor-default items-center gap-1 px-1 py-0.5 text-foreground/60">
        {segment.isHome ? (
          <>
            <HugeiconsIcon
              icon={Home03Icon}
              className="size-3"
              strokeWidth={1.75}
            />
            Home
          </>
        ) : segment.isComputerRoot ? (
          <>
            <HugeiconsIcon
              icon={ComputerIcon}
              className="size-3"
              strokeWidth={1.75}
            />
            {label}
          </>
        ) : (
          label
        )}
      </BreadcrumbPage>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <BreadcrumbPage className="flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-foreground hover:bg-accent">
          {segment.isHome ? (
            <>
              <HugeiconsIcon
                icon={Home03Icon}
                className="size-3"
                strokeWidth={1.75}
              />
              Home
            </>
          ) : segment.isComputerRoot ? (
            <>
              <HugeiconsIcon
                icon={ComputerIcon}
                className="size-3"
                strokeWidth={1.75}
              />
              {label}
            </>
          ) : (
            label
          )}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className="size-3 opacity-70"
            strokeWidth={2}
          />
        </BreadcrumbPage>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {children === null ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("statusbar.loading")}
          </div>
        ) : children.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {error ?? t("statusbar.noSubfolders")}
          </div>
        ) : (
          children.map((child) => (
            <DropdownMenuItem
              key={child}
              onSelect={() =>
                onCd(
                  path === null || path.endsWith("/")
                    ? child
                    : `${path}/${child}`,
                )
              }
            >
              <HugeiconsIcon
                icon={Folder01Icon}
                className="size-3.5 text-muted-foreground"
                strokeWidth={1.75}
              />
              {child}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CollapsedSegments({
  segments,
  onCd,
  locked = false,
}: {
  segments: Segment[];
  onCd: (p: string) => void;
  locked?: boolean;
}) {
  return (
    <span className="contents md:hidden">
      <BreadcrumbItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Show hidden folders"
              aria-disabled={locked}
              className={cn(
                "flex items-center rounded-sm px-1 text-muted-foreground",
                locked
                  ? "cursor-default opacity-60"
                  : "hover:bg-accent hover:text-foreground",
              )}
            >
              <HugeiconsIcon
                icon={MoreHorizontalIcon}
                className="size-3"
                strokeWidth={1.75}
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            {segments.map((s) =>
              s.isComputerRoot ? null : (
                <DropdownMenuItem
                  key={s.fullPath}
                  disabled={locked}
                  onSelect={() => onCd(s.fullPath)}
                >
                  <HugeiconsIcon
                    icon={s.isHome ? Home03Icon : Folder01Icon}
                    className="size-3.5 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                  <span className="truncate">{segmentLabel(s)}</span>
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </BreadcrumbItem>
      <BreadcrumbSeparator className="[&>svg]:size-3" />
    </span>
  );
}
