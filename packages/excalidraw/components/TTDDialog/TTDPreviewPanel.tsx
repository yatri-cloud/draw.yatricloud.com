import { t } from "../../i18n";
import { ArrowRightIcon } from "../icons";

import { TTDDialogPanel } from "./TTDDialogPanel";
import { TTDDialogOutput } from "./TTDDialogOutput";

import { FRAME_RATIOS } from "./frame";

import type { TTDPanelAction } from "./TTDDialogPanel";

import type { DiagramDirection } from "./TTDContext";
import type { FrameRatio } from "./frame";

const DIRECTIONS: { value: DiagramDirection; label: string; title: string }[] =
  [
    { value: "auto", label: "Auto", title: "Best arrangement for the frame" },
    { value: "LR", label: "Horizontal", title: "Left to right" },
    { value: "TB", label: "Vertical", title: "Top to bottom" },
  ];

interface TTDPreviewPanelProps {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  error: Error | null;
  loaded: boolean;
  onInsert: () => void;
  hideErrorDetails?: boolean;
  direction: DiagramDirection;
  onDirectionChange: (direction: DiagramDirection) => void;
  frameRatio: FrameRatio;
  onFrameRatioChange: (ratio: FrameRatio) => void;
}

/** A small segmented control. */
const OptionGroup = <T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
}) => (
  <div className="ttd-dialog-direction" role="radiogroup" aria-label={label}>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="radio"
        title={option.title}
        aria-checked={value === option.value}
        className={`ttd-dialog-direction__option${
          value === option.value ? " ttd-dialog-direction__option--active" : ""
        }`}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export const TTDPreviewPanel = ({
  canvasRef,
  error,
  loaded,
  onInsert,
  hideErrorDetails,
  direction,
  onDirectionChange,
  frameRatio,
  onFrameRatioChange,
}: TTDPreviewPanelProps) => {
  const actions: TTDPanelAction[] = [
    {
      action: onInsert,
      label: t("chat.insert"),
      icon: ArrowRightIcon,
      variant: "button",
    },
  ];

  return (
    <TTDDialogPanel
      panelActionJustifyContent="flex-end"
      panelActions={actions}
      className="ttd-dialog-preview-panel"
      renderTopRight={() => (
        <div className="ttd-dialog-layout-options">
          <OptionGroup
            label="Diagram layout"
            options={DIRECTIONS}
            value={direction}
            onChange={onDirectionChange}
          />
          <OptionGroup
            label="Frame shape"
            options={FRAME_RATIOS}
            value={frameRatio}
            onChange={onFrameRatioChange}
          />
        </div>
      )}
    >
      <TTDDialogOutput
        canvasRef={canvasRef}
        error={error}
        loaded={loaded}
        hideErrorDetails={hideErrorDetails}
      />
    </TTDDialogPanel>
  );
};
