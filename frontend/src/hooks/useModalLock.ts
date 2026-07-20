import { useLayoutEffect } from "react";

type ScrollContainerState = {
  bodyOverflow: string;
  htmlOverflow: string;
  mainOverflow: string;
  mainOverscrollBehavior: string;
};

let activeModalLocks = 0;
let savedState: ScrollContainerState | null = null;

function getScrollContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-app-shell-scroll-container="true"]');
}

function lockScrollContainers() {
  const body = document.body;
  const html = document.documentElement;
  const main = getScrollContainer();

  if (activeModalLocks === 0) {
    savedState = {
      bodyOverflow: body.style.overflow,
      htmlOverflow: html.style.overflow,
      mainOverflow: main?.style.overflow ?? "",
      mainOverscrollBehavior: main?.style.overscrollBehavior ?? "",
    };
    body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    if (main) {
      main.style.overflow = "hidden";
      main.style.overscrollBehavior = "contain";
    }
  }

  activeModalLocks += 1;
}

function unlockScrollContainers() {
  activeModalLocks = Math.max(0, activeModalLocks - 1);
  if (activeModalLocks > 0 || !savedState) return;

  const body = document.body;
  const html = document.documentElement;
  const main = getScrollContainer();

  body.style.overflow = savedState.bodyOverflow;
  html.style.overflow = savedState.htmlOverflow;
  if (main) {
    main.style.overflow = savedState.mainOverflow;
    main.style.overscrollBehavior = savedState.mainOverscrollBehavior;
  }
  savedState = null;
}

export function useModalLock(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return;
    lockScrollContainers();
    return () => {
      unlockScrollContainers();
    };
  }, [active]);
}
