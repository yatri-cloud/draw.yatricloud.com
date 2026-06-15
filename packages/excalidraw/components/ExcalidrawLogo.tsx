import "./ExcalidrawLogo.scss";

const LogoIcon = () => (
  <img
    src="/apple-touch-icon.png"
    alt="Yatri Draw Logo"
    className="ExcalidrawLogo-icon"
    style={{ flexShrink: 0, borderRadius: "50%", objectFit: "contain" }}
  />
);

const LogoText = () => (
  <svg
    viewBox="0 0 320 55"
    xmlns="http://www.w3.org/2000/svg"
    className="ExcalidrawLogo-text"
  >
    <text
      x="0"
      y="42"
      fill="currentColor"
      style={{
        fontFamily: "Virgil, Assistant, sans-serif",
        fontSize: "44px",
        fontWeight: "bold",
      }}
    >
      Yatri Draw
    </text>
  </svg>
);

type LogoSize = "xs" | "small" | "normal" | "large" | "custom" | "mobile";

interface LogoProps {
  size?: LogoSize;
  withText?: boolean;
  style?: React.CSSProperties;
  /**
   * If true, the logo will not be wrapped in a Link component.
   * The link prop will be ignored as well.
   * It will merely be a plain div.
   */
  isNotLink?: boolean;
}

export const ExcalidrawLogo = ({
  style,
  size = "small",
  withText,
}: LogoProps) => {
  return (
    <div className={`ExcalidrawLogo is-${size}`} style={style}>
      <LogoIcon />
      {withText && <LogoText />}
    </div>
  );
};
