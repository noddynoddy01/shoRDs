import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";
import { colors as defaultColors, radius } from "../constants/theme";

type LineChartData = {
  type: "line-chart";
  title: string;
  labels: string[];
  values: number[];
};

type BarChartData = {
  type: "bar-chart";
  title: string;
  labels: string[];
  values: number[];
};

type FlowChartData = {
  type: "flow-chart";
  title: string;
  steps: string[];
};

export type IllustrationData = LineChartData | BarChartData | FlowChartData;

type ResearchIllustrationProps = {
  dataString: string;
};

export function ResearchIllustration({ dataString }: ResearchIllustrationProps) {
  const { colors, fontSizeScale, theme } = useTheme();
  const styles = getStyles(colors, fontSizeScale, theme);

  let data: IllustrationData | null = null;
  try {
    data = JSON.parse(dataString) as IllustrationData;
  } catch (err) {
    // If it's not JSON, parse as simple title fallback
    if (dataString && dataString.trim()) {
      data = {
        type: "flow-chart",
        title: "Scientific Process Map",
        steps: dataString.split(",").map((s) => s.trim())
      };
    }
  }

  if (!data) return null;

  const renderContent = () => {
    switch (data.type) {
      case "bar-chart":
        return renderBarChart(data, colors, styles);
      case "line-chart":
        return renderLineChart(data, colors, styles);
      case "flow-chart":
        return renderFlowChart(data, colors, styles);
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.chartTitle}>📊 {data.title || "Research Data Visual"}</Text>
      <View style={styles.chartBody}>
        {renderContent()}
      </View>
    </View>
  );
}

// 1. Render Bar Chart
function renderBarChart(data: BarChartData, colors: any, styles: any) {
  const maxVal = Math.max(...data.values, 1);
  const containerHeight = 110;

  return (
    <View style={styles.barChartContainer}>
      <View style={styles.barRow}>
        {data.values.map((val, idx) => {
          const barHeight = (val / maxVal) * containerHeight;
          const label = data.labels[idx] || `Item ${idx + 1}`;
          
          return (
            <View key={idx} style={styles.barColumn}>
              <View style={styles.barWrapper}>
                <Text style={styles.barValue}>{val}</Text>
                <View style={[styles.barActive, { height: Math.max(barHeight, 8) }]} />
              </View>
              <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// 2. Render Line Chart (Dependency-free connector drawing)
function renderLineChart(data: LineChartData, colors: any, styles: any) {
  const maxVal = Math.max(...data.values, 1);
  const containerHeight = 90;
  const numPoints = data.values.length;
  
  // Calculate relative coordinate points (X in %, Y in pixels)
  const points = data.values.map((val, idx) => {
    const xPct = numPoints > 1 ? (idx / (numPoints - 1)) * 85 + 5 : 50; // percentage
    const yVal = (val / maxVal) * containerHeight; // Y from bottom
    return { xPct, yVal, rawVal: val };
  });

  return (
    <View style={styles.lineChartContainer}>
      {/* Grid lines */}
      <View style={styles.gridLinesContainer}>
        <View style={styles.gridLine} />
        <View style={styles.gridLine} />
        <View style={styles.gridLine} />
      </View>

      <View style={[styles.lineChartPlot, { height: containerHeight }]}>
        {/* Render lines connecting the dots */}
        {points.map((pt, idx) => {
          if (idx === numPoints - 1) return null;
          const nextPt = points[idx + 1];
          
          // Basic diagonal fill or step line (since drawing true diagonal in pure CSS requires angle calculations,
          // we draw a horizontal-vertical step connector or render clean dots + connection grids which looks very technical!)
          // To keep it 100% stable without trigonometric runtime weight, we draw a secondary grid projection:
          return (
            <View
              key={`line-${idx}`}
              style={[
                styles.lineSegment,
                {
                  left: `${pt.xPct}%`,
                  width: `${nextPt.xPct - pt.xPct}%`,
                  bottom: pt.yVal,
                  height: Math.abs(nextPt.yVal - pt.yVal) + 1,
                  borderLeftWidth: 1.5,
                  borderBottomWidth: nextPt.yVal >= pt.yVal ? 1.5 : 0,
                  borderTopWidth: nextPt.yVal < pt.yVal ? 1.5 : 0,
                  borderColor: colors.accentSoft,
                  opacity: 0.6
                }
              ]}
            />
          );
        })}

        {/* Render interactive dots */}
        {points.map((pt, idx) => (
          <View
            key={`dot-${idx}`}
            style={[
              styles.chartDot,
              { left: `${pt.xPct}%`, bottom: pt.yVal - 5 }
            ]}
          >
            <View style={styles.chartDotInner} />
            <Text style={styles.dotValue}>{pt.rawVal}</Text>
          </View>
        ))}
      </View>

      {/* X Axis Labels */}
      <View style={styles.xAxisRow}>
        {data.labels.map((label, idx) => {
          const xPct = numPoints > 1 ? (idx / (numPoints - 1)) * 85 + 5 : 50;
          return (
            <Text
              key={idx}
              style={[styles.xAxisLabel, { left: `${xPct - 6}%`, width: "12%" }]}
              numberOfLines={1}
            >
              {label}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

// 3. Render Flow Chart
function renderFlowChart(data: FlowChartData, colors: any, styles: any) {
  return (
    <View style={styles.flowContainer}>
      {data.steps.map((step, idx) => {
        const isLast = idx === data.steps.length - 1;
        return (
          <React.Fragment key={idx}>
            <View style={styles.flowStepCard}>
              <Text style={styles.flowStepIdx}>{idx + 1}</Text>
              <Text style={styles.flowStepText} numberOfLines={1}>{step}</Text>
            </View>
            {!isLast && (
              <View style={styles.flowArrow}>
                <Ionicons name="arrow-forward" size={14} color={colors.accentSoft} />
              </View>
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string) {
  return StyleSheet.create({
    container: {
      backgroundColor: theme === "light" || theme === "sepia" ? "rgba(6, 182, 212, 0.03)" : "rgba(6, 182, 212, 0.02)",
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.md,
      padding: 12,
      marginVertical: 4,
      gap: 10
    },
    chartTitle: {
      fontSize: 11 * scale,
      fontWeight: "800",
      color: colors.text,
      letterSpacing: 0.5,
      textTransform: "uppercase"
    },
    chartBody: {
      height: 140,
      justifyContent: "center",
      alignItems: "center"
    },
    // Bar Chart Styles
    barChartContainer: {
      width: "100%",
      height: "100%",
      justifyContent: "flex-end"
    },
    barRow: {
      flexDirection: "row",
      justifyContent: "space-around",
      alignItems: "flex-end",
      paddingBottom: 4
    },
    barColumn: {
      alignItems: "center",
      width: "22%"
    },
    barWrapper: {
      justifyContent: "flex-end",
      alignItems: "center",
      width: "100%",
      height: 110
    },
    barValue: {
      fontSize: 10 * scale,
      fontWeight: "700",
      color: colors.accentSoft,
      marginBottom: 3
    },
    barActive: {
      width: 14,
      backgroundColor: colors.accentSoft,
      borderTopLeftRadius: 4,
      borderTopRightRadius: 4,
      shadowColor: colors.accentSoft,
      shadowOpacity: 0.12,
      shadowRadius: 3
    },
    barLabel: {
      fontSize: 9 * scale,
      fontWeight: "600",
      color: colors.subdued,
      marginTop: 4,
      textAlign: "center"
    },
    // Line Chart Styles
    lineChartContainer: {
      width: "100%",
      height: "100%",
      position: "relative"
    },
    gridLinesContainer: {
      position: "absolute",
      left: 0,
      right: 0,
      top: 0,
      bottom: 20,
      justifyContent: "space-between",
      pointerEvents: "none"
    },
    gridLine: {
      height: 1,
      backgroundColor: colors.border,
      borderStyle: "dashed",
      opacity: 0.5
    },
    lineChartPlot: {
      width: "100%",
      position: "absolute",
      bottom: 20
    },
    chartDot: {
      position: "absolute",
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.accentSoft,
      borderColor: colors.card,
      borderWidth: 1.5,
      zIndex: 10,
      alignItems: "center"
    },
    chartDotInner: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.card
    },
    dotValue: {
      position: "absolute",
      top: -14,
      fontSize: 9 * scale,
      fontWeight: "700",
      color: colors.text,
      textAlign: "center",
      width: 30
    },
    lineSegment: {
      position: "absolute",
      borderStyle: "solid"
    },
    xAxisRow: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      height: 20,
      flexDirection: "row"
    },
    xAxisLabel: {
      position: "absolute",
      fontSize: 9 * scale,
      fontWeight: "600",
      color: colors.subdued,
      textAlign: "center"
    },
    // Flow Chart Styles
    flowContainer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      flexWrap: "wrap",
      gap: 6,
      width: "100%"
    },
    flowStepCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.cardElevated,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 8,
      paddingVertical: 8,
      gap: 6,
      maxWidth: "28%"
    },
    flowStepIdx: {
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: colors.accentSoft,
      color: "#FFFFFF",
      fontSize: 9 * scale,
      fontWeight: "800",
      textAlign: "center",
      lineHeight: 16
    },
    flowStepText: {
      fontSize: 10 * scale,
      fontWeight: "700",
      color: colors.text,
      flex: 1
    },
    flowArrow: {
      alignItems: "center",
      justifyContent: "center"
    }
  });
}
