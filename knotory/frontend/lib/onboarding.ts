const ONBOARDING_KEY = "knotory_onboarding_done";
const LIBRARY_GUIDE_KEY = "knotory_library_guide_dismissed";
const SAVE_HINT_KEY = "knotory_save_hint_shown";

export function isOnboardingDone(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(localStorage.getItem(ONBOARDING_KEY));
}

export function completeOnboarding(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ONBOARDING_KEY, "1");
}

export function shouldRedirectFeedToWelcome(): boolean {
  if (typeof window === "undefined") return false;
  return !localStorage.getItem(ONBOARDING_KEY);
}

export function isLibraryGuideDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(localStorage.getItem(LIBRARY_GUIDE_KEY));
}

export function dismissLibraryGuide(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LIBRARY_GUIDE_KEY, "1");
}

export function shouldShowSaveHint(): boolean {
  if (typeof window === "undefined") return false;
  return !localStorage.getItem(SAVE_HINT_KEY);
}

export function markSaveHintShown(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SAVE_HINT_KEY, "1");
}
