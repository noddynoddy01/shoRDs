import React, { useState } from "react";
import { StyleSheet, Text, View, Pressable, Modal, Dimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../context/ThemeContext";
import { colors as defaultColors, radius, spacing } from "../constants/theme";

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
  compact?: boolean;
};

export function ResearchIllustration({ dataString, compact }: ResearchIllustrationProps) {
  const { colors, fontSizeScale, theme } = useTheme();
  const [modalVisible, setModalVisible] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);

  const styles = getStyles(colors, fontSizeScale, theme, compact);

  let data: IllustrationData | null = null;
  try {
    data = JSON.parse(dataString) as IllustrationData;
  } catch (err) {
    if (dataString && dataString.trim()) {
      data = {
        type: "flow-chart",
        title: "Scientific Process Map",
        steps: dataString.split(",").map((s) => s.trim())
      };
    }
  }

  if (!data) return null;

  const renderContent = (isZoomed?: boolean) => {
    const activeStyles = getStyles(colors, fontSizeScale, theme, !isZoomed);
    switch (data.type) {
      case "bar-chart":
        return renderBarChart(data, colors, activeStyles, !isZoomed);
      case "line-chart":
        return renderLineChart(data, colors, activeStyles, !isZoomed);
      case "flow-chart":
        return renderFlowChart(data, colors, activeStyles, !isZoomed);
      default:
        return null;
    }
  };

  const handleZoomIn = () => setZoomScale((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoomScale((prev) => Math.max(prev - 0.25, 1));
  const handleReset = () => setZoomScale(1);

  return (
    <>
      <Pressable style={styles.container} onPress={() => setModalVisible(true)}>
        <Text style={styles.chartTitle}>{data.title || "Research Data Visual"}</Text>
        <View style={styles.chartBody}>
          {renderContent(false)}
        </View>
        <View style={styles.expandHint}>
          <Ionicons name="expand-outline" size={10} color={colors.subdued} />
          <Text style={styles.expandHintText}>Tap to zoom</Text>
        </View>
      </Pressable>

      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setModalVisible(false);
          handleReset();
        }}
      >
        <View style={styles.modalBg}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle} numberOfLines={1}>{data.title}</Text>
            <Pressable
              style={styles.closeBtn}
              onPress={() => {
                setModalVisible(false);
                handleReset();
              }}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.modalBody}>
            <View style={{ transform: [{ scale: zoomScale }], width: "100%", alignItems: "center" }}>
              <View style={{ width: Dimensions.get("window").width - 32 }}>
                {renderContent(true)}
              </View>
            </View>
          </View>

          <View style={styles.zoomControls}>
            <Pressable style={styles.controlBtn} onPress={handleZoomOut}>
              <Ionicons name="remove-circle-outline" size={24} color={colors.text} />
            </Pressable>
            <Text style={styles.scaleText}>{Math.round(zoomScale * 100)}%</Text>
            <Pressable style={styles.controlBtn} onPress={handleZoomIn}>
              <Ionicons name="add-circle-outline" size={24} color={colors.text} />
            </Pressable>
            {zoomScale > 1 && (
              <Pressable style={styles.controlBtn} onPress={handleReset}>
                <Ionicons name="refresh-circle-outline" size={24} color={colors.primary} />
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

// 1. Render Bar Chart
function renderBarChart(data: BarChartData, colors: any, styles: any, compact?: boolean) {
  const maxVal = Math.max(...data.values, 1);
  const containerHeight = compact ? 60 : 120;

  return (
    <View style={styles.barChartContainer}>
      <View style={styles.barRow}>
        {data.values.map((val, idx) => {
          const barHeight = (val / maxVal) * containerHeight;
          const label = data.labels[idx] || `Item ${idx + 1}`;
          
          return (
            <View key={idx} style={styles.barColumn}>
              <View style={[styles.barWrapper, compact && { height: 60 }]}>
                <Text style={styles.barValue}>{val}</Text>
                <View style={[styles.barActiveContainer, { height: Math.max(barHeight, 8) }]}>
                  <LinearGradient
                    colors={[colors.primary, colors.primary]}
                    style={StyleSheet.absoluteFill}
                  />
                </View>
              </View>
              <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// 2. Render Line Chart
function renderLineChart(data: LineChartData, colors: any, styles: any, compact?: boolean) {
  const maxVal = Math.max(...data.values, 1);
  const containerHeight = compact ? 50 : 100;
  const numPoints = data.values.length;
  
  const points = data.values.map((val, idx) => {
    const xPct = numPoints > 1 ? (idx / (numPoints - 1)) * 85 + 5 : 50;
    const yVal = (val / maxVal) * containerHeight;
    return { xPct, yVal, rawVal: val };
  });

  return (
    <View style={styles.lineChartContainer}>
      <View style={styles.gridLinesContainer}>
        <View style={styles.gridLine} />
        <View style={styles.gridLine} />
        <View style={styles.gridLine} />
      </View>

      <View style={[styles.lineChartPlot, { height: containerHeight }]}>
        {/* Render gradient polygons under each line segment */}
        {points.map((pt, idx) => {
          if (idx === numPoints - 1) return null;
          const nextPt = points[idx + 1];
          const segmentHeight = (pt.yVal + nextPt.yVal) / 2;
          
          return (
            <View
              key={`area-${idx}`}
              style={{
                position: "absolute",
                left: `${pt.xPct}%`,
                width: `${nextPt.xPct - pt.xPct}%`,
                bottom: 0,
                height: segmentHeight,
                opacity: 0.15
              }}
            >
              <LinearGradient
                colors={[colors.primary + "1A", "transparent"]}
                style={StyleSheet.absoluteFill}
              />
            </View>
          );
        })}

        {/* Render lines connecting the dots */}
        {points.map((pt, idx) => {
          if (idx === numPoints - 1) return null;
          const nextPt = points[idx + 1];
          
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
                  borderColor: colors.primary,
                  opacity: 0.8
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
            <View style={[styles.chartDotInner, { backgroundColor: colors.primary }]} />
            <Text style={styles.dotValue}>{pt.rawVal}</Text>
          </View>
        ))}
      </View>

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
function renderFlowChart(data: FlowChartData, colors: any, styles: any, compact?: boolean) {
  return (
    <View style={styles.flowContainer}>
      {data.steps.map((step, idx) => {
        const isLast = idx === data.steps.length - 1;
        return (
          <React.Fragment key={idx}>
            <View style={[styles.flowStepCard, compact && { paddingVertical: 4, paddingHorizontal: 6 }]}>
              <View style={styles.flowStepIdxContainer}>
                <Text style={styles.flowStepIdx}>{idx + 1}</Text>
              </View>
              <Text style={styles.flowStepText} numberOfLines={1}>{step}</Text>
            </View>
            {!isLast && (
              <View style={styles.flowArrow}>
                <Ionicons name="arrow-forward" size={compact ? 12 : 14} color={colors.primary} />
              </View>
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string, compact?: boolean) {
  return StyleSheet.create({
    container: {
      backgroundColor: "rgba(255, 255, 255, 0.015)",
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.md,
      padding: compact ? 8 : 14,
      marginVertical: compact ? 2 : 6,
      gap: compact ? 4 : 8,
      width: "100%",
      position: "relative"
    },
    chartTitle: {
      fontSize: (compact ? 9 : 11) * scale,
      fontWeight: "800",
      color: colors.text,
      letterSpacing: 0.5,
      textTransform: "uppercase"
    },
    chartBody: {
      height: compact ? 80 : 140,
      justifyContent: "center",
      alignItems: "center"
    },
    expandHint: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      position: "absolute",
      right: 10,
      bottom: 8
    },
    expandHintText: {
      fontSize: 8 * scale,
      color: colors.subdued,
      fontWeight: "700"
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
      color: colors.muted,
      marginBottom: 3
    },
    barActiveContainer: {
      width: 14,
      borderRadius: radius.sm,
      overflow: "hidden"
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
      backgroundColor: colors.surface,
      borderColor: colors.primary,
      borderWidth: 2,
      zIndex: 10,
      alignItems: "center",
      justifyContent: "center"
    },
    chartDotInner: {
      width: 4,
      height: 4,
      borderRadius: 2
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
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.md,
      backgroundColor: colors.cardElevated,
      paddingHorizontal: 8,
      paddingVertical: 8,
      gap: 6,
      maxWidth: "28%",
      overflow: "hidden",
      position: "relative"
    },
    flowStepIdxContainer: {
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: colors.primary + "20",
      borderColor: colors.primary + "40",
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden"
    },
    flowStepIdx: {
      color: colors.primary,
      fontSize: 9 * scale,
      fontWeight: "800",
      textAlign: "center"
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
    },
    // Modal Styles
    modalBg: {
      flex: 1,
      backgroundColor: "rgba(3, 7, 18, 0.98)",
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.md
    },
    modalHeader: {
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderColor: colors.border
    },
    modalTitle: {
      color: colors.text,
      fontSize: 14 * scale,
      fontWeight: "800",
      flex: 1,
      marginRight: 10
    },
    closeBtn: {
      padding: 4
    },
    modalBody: {
      flex: 1,
      width: "100%",
      justifyContent: "center",
      alignItems: "center"
    },
    zoomControls: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      paddingVertical: spacing.lg
    },
    controlBtn: {
      padding: 6
    },
    scaleText: {
      color: colors.text,
      fontSize: 14 * scale,
      fontWeight: "700",
      minWidth: 46,
      textAlign: "center"
    }
  });
}
