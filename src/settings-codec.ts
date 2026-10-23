import { DEFAULT_SETTINGS } from "./constants";
import type { DashboardSettings } from "./types";
import { normalizeTaskCategories } from "./categories";
import { normalizePreferences } from "./preferences";
import { normalizeStudyCheckins, LEGACY_STUDY_COURSES, normalizeStudyCourses } from "./study";
import { normalizePanelOrder, normalizeTaskOrder, normalizePanelSizes, normalizePanelVisibility, normalizeMonthlyPlan, normalizeMonthlyPlanDone, normalizeMonthlyPlanCategory } from "./configuration";
import { normalizePlanItems } from "./monthly-items";

export function decodeSettings(saved: any): DashboardSettings {
    const settings: DashboardSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    // Retired settings are dropped; only current settings are loaded and saved.
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (saved && Object.prototype.hasOwnProperty.call(saved, key)) {
        Object.assign(settings, { [key]: saved[key] });
      }
    }
    settings.dailySetupComplete = saved?.dailySetupComplete ?? Boolean(saved);
    settings.taskCategories = normalizeTaskCategories(settings.taskCategories);
    Object.assign(settings, normalizePreferences(settings));
    if (!settings.taskCategories.includes(settings.defaultTaskCategory)) settings.defaultTaskCategory = "";
    settings.studyEnabled = settings.studyEnabled === true;
    settings.studyCourses = normalizeStudyCourses(saved?.studyCourses ?? (saved?.studyCheckins?.length ? LEGACY_STUDY_COURSES : []));
    settings.panelOrder = normalizePanelOrder(settings.panelOrder);
    settings.taskOrder = normalizeTaskOrder(settings.taskOrder);
    settings.panelSizes = normalizePanelSizes(settings.panelSizes);
    settings.visiblePanels = normalizePanelVisibility(settings.visiblePanels);
    settings.studyCheckins = normalizeStudyCheckins(settings.studyCheckins);
    settings.monthlyPlan = normalizeMonthlyPlan(settings.monthlyPlan);
    settings.monthlyPlanDone = normalizeMonthlyPlanDone(settings.monthlyPlanDone);
    settings.monthlyPlanCategory = normalizeMonthlyPlanCategory(
      settings.monthlyPlanCategory,
    );
    normalizePlanItems(settings);
    return settings;
}
