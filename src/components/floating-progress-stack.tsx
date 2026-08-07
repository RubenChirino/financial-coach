import { CategorizeProgress } from "@/components/categorize/categorize-progress";
import { RecalcPredictionsProgress } from "@/components/predictions/recalc-progress";
import { DetectTravelsProgress } from "@/components/travels/detect-progress";

/**
 * Bottom-right stack for page-persistent background-task cards. Each child
 * renders null while idle, so the container collapses to zero height and blocks
 * nothing. When several runs (categorization, "detect trips", predictions
 * recalculation) are active they stack vertically with a gap instead of
 * overlapping.
 */
export function FloatingProgressStack() {
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      <CategorizeProgress />
      <DetectTravelsProgress />
      <RecalcPredictionsProgress />
    </div>
  );
}
