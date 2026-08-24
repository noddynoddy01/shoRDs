import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";

type MathRendererProps = {
  latex: string;
};

export function MathRenderer({ latex }: MathRendererProps) {
  const { colors, fontSizeScale } = useTheme();

  const get9PartEquationExplanation = (eq: string) => {
    if (eq.includes("L_{task}") || eq.includes("L_{reg}") || eq.includes("L_{total}")) {
      return {
        name: "Regularized Multi-Task Loss Formulation",
        purpose: "Formulates total objective loss by combining task-specific prediction error with L2 regularization penalty.",
        variables: [
          { symbol: "L_{total}", meaning: "Total composite objective loss metric minimized during backpropagation." },
          { symbol: "L_{task}", meaning: "Primary task cross-entropy error metric." },
          { symbol: "\\lambda", meaning: "Hyperparameter scaling factor balancing regularization penalty against task loss." },
          { symbol: "L_{reg}", meaning: "L2 weight decay penalty preventing parameter overfitting." }
        ],
        derivation: "Derived by taking the negative log-likelihood of task outcomes and adding a quadratic L2 parameter norm penalty.",
        plainEnglish: "The model calculates how wrong its predictions are, then adds a small penalty if its internal weights grow too large.",
        engineeringIntuition: "If prediction accuracy improves, L_{task} decreases; if model weights grow too large, \\lambda L_{reg} penalizes the loss.",
        workedExample: "With L_{task} = 0.45 and \\lambda L_{reg} = 0.05, total loss equals 0.50.",
        whereUsed: "Used during backpropagation to update model parameter weights via gradient descent.",
        limitations: "Sensitive to hyperparameter choice of \\lambda; requires tuning for out-of-distribution tasks."
      };
    }

    if (eq.includes("softmax") || eq.includes("Q K^T")) {
      return {
        name: "Scaled Dot-Product Attention Equation",
        purpose: "Computes alignment weights between Query and Key vectors to aggregate Value representations.",
        variables: [
          { symbol: "Q", meaning: "Query tensor representing current target token embeddings." },
          { symbol: "K", meaning: "Key tensor representing context token embeddings." },
          { symbol: "V", meaning: "Value tensor containing content representations." },
          { symbol: "d_k", meaning: "Dimensionality scale factor preventing dot-product vanishing gradients." }
        ],
        derivation: "Derived from dot-product similarity scaling normalized by softmax probability distribution.",
        plainEnglish: "Measures how much attention each word should pay to every other word in a sentence.",
        engineeringIntuition: "High dot-product agreement between Query and Key produces larger attention weight, assigning higher focus to relevant context tokens.",
        workedExample: "Dot-product Q*K^T = 8.0, scaled by sqrt(64)=8 gives 1.0; softmax converts this into probability weight 0.82.",
        whereUsed: "Used in multi-head self-attention layers in Transformers.",
        limitations: "Requires O(N^2) sequence memory complexity unless sparse kernel tiling is applied."
      };
    }

    return {
      name: "Mathematical Formulation",
      purpose: "Defines objective relationship for optimization during model training.",
      variables: [
        { symbol: "x", meaning: "Input feature space representation." },
        { symbol: "\\theta", meaning: "Model parameter weights optimized via gradient descent." }
      ],
      derivation: "Derived from empirical loss minimisation over training batches.",
      plainEnglish: "Calculates mathematical transformation from inputs to target predictions.",
      engineeringIntuition: "Guides parameters towards empirical convergence.",
      workedExample: "Input vector x mapped through weight matrix theta.",
      whereUsed: "Used in model optimization loops.",
      limitations: "Requires non-linear activation functions to prevent collapse."
    };
  };

  const exp = get9PartEquationExplanation(latex);
  const styles = getStyles(colors, fontSizeScale);

  return (
    <View style={styles.card}>
      {/* 1. Equation Name */}
      <View style={styles.headerRow}>
        <Ionicons name="calculator-outline" size={16} color={colors.primary} />
        <Text style={styles.eqName}>{exp.name}</Text>
      </View>

      {/* Raw LaTeX Box */}
      <View style={styles.latexBox}>
        <Text style={styles.latexText}>{latex}</Text>
      </View>

      {/* 2. Plain English */}
      <Text style={styles.sectionTitle}>Plain English Explanation:</Text>
      <Text style={styles.bodyText}>{exp.plainEnglish}</Text>

      {/* 3. Purpose */}
      <Text style={[styles.sectionTitle, { marginTop: spacing.xs }]}>Purpose & Objective:</Text>
      <Text style={styles.bodyText}>{exp.purpose}</Text>

      {/* 4. Variables */}
      <Text style={[styles.sectionTitle, { marginTop: spacing.xs }]}>Variables Breakdown:</Text>
      {exp.variables.map((v, idx) => (
        <View key={idx} style={styles.varRow}>
          <Text style={styles.varSymbol}>{v.symbol}</Text>
          <Text style={styles.varMeaning}>: {v.meaning}</Text>
        </View>
      ))}

      {/* 5. Derivation */}
      <Text style={[styles.sectionTitle, { marginTop: spacing.xs }]}>Derivation:</Text>
      <Text style={styles.bodyText}>{exp.derivation}</Text>

      {/* 6. Engineering Intuition */}
      <View style={styles.intuitionBox}>
        <Ionicons name="bulb-outline" size={14} color={colors.primary} />
        <Text style={styles.intuitionText}><Text style={{ fontWeight: "700" }}>Engineering Intuition:</Text> {exp.engineeringIntuition}</Text>
      </View>

      {/* 7. Worked Example */}
      <Text style={[styles.sectionTitle, { marginTop: spacing.xs }]}>Worked Example:</Text>
      <Text style={styles.bodyText}>{exp.workedExample}</Text>

      {/* 8. Where Used & 9. Limitations */}
      <Text style={[styles.sectionTitle, { marginTop: spacing.xs }]}>Where Used & Limitations:</Text>
      <Text style={styles.bodyText}>• Where Used: {exp.whereUsed}</Text>
      <Text style={styles.bodyText}>• Limitations: {exp.limitations}</Text>
    </View>
  );
}

function getStyles(colors: any, scale: number) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      padding: spacing.sm + 4,
      borderRadius: radius.md,
      marginVertical: spacing.xs,
      borderWidth: 1,
      borderColor: colors.border
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 4,
      gap: 6
    },
    eqName: {
      fontSize: 13 * scale,
      fontWeight: "800",
      color: colors.primary
    },
    latexBox: {
      backgroundColor: colors.background,
      padding: spacing.xs + 4,
      borderRadius: radius.sm,
      marginVertical: 4,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      alignItems: "center"
    },
    latexText: {
      fontFamily: "monospace",
      fontSize: 14 * scale,
      fontWeight: "800",
      color: colors.text
    },
    sectionTitle: {
      fontSize: 11 * scale,
      fontWeight: "700",
      color: colors.text,
      marginTop: 2
    },
    bodyText: {
      fontSize: 12 * scale,
      color: colors.subdued,
      lineHeight: 18
    },
    varRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginVertical: 1
    },
    varSymbol: {
      fontFamily: "monospace",
      fontSize: 11 * scale,
      fontWeight: "800",
      color: colors.primary
    },
    varMeaning: {
      fontSize: 11 * scale,
      color: colors.subdued,
      flex: 1
    },
    intuitionBox: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.primary + "10",
      padding: spacing.xs,
      borderRadius: 4,
      marginTop: spacing.xs,
      gap: 6
    },
    intuitionText: {
      fontSize: 11 * scale,
      color: colors.primary,
      flex: 1,
      lineHeight: 16
    }
  });
}
