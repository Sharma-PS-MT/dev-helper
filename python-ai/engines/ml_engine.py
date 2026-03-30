"""
XGBoost ML Prediction Engine.
Trains an XGBoost ensemble with Optuna hyperparameter tuning,
walk-forward validation, and confidence scoring.
Provides feature importance for explainability.
"""

import os
import json
import time
import pickle
import numpy as np
import pandas as pd
from pathlib import Path
from typing import Optional

import xgboost as xgb
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.preprocessing import StandardScaler

from config import ML_ENGINE_CONFIG as ML, INTERVAL_SECONDS
from features.pipeline import build_features, get_feature_columns

# Model storage directory
MODEL_DIR = Path(__file__).parent.parent / "models"
MODEL_DIR.mkdir(exist_ok=True)


class MLEngine:
    """XGBoost-based crypto price direction predictor with Optuna tuning."""

    def __init__(self):
        self.model: Optional[xgb.XGBClassifier] = None
        self.scaler: Optional[StandardScaler] = None
        self.feature_columns: list = []
        self.training_metrics: dict = {}
        self.model_timestamp: float = 0
        self.model_symbol: str = ""

    # =================================================================
    # MODEL PERSISTENCE
    # =================================================================

    def _model_path(self, symbol: str, interval: str) -> Path:
        return MODEL_DIR / f"xgb_{symbol}_{interval}.pkl"

    def _meta_path(self, symbol: str, interval: str) -> Path:
        return MODEL_DIR / f"xgb_{symbol}_{interval}_meta.json"

    def save_model(self, symbol: str, interval: str):
        """Save trained model, scaler, and metadata to disk."""
        path = self._model_path(symbol, interval)
        with open(path, "wb") as f:
            pickle.dump({
                "model": self.model,
                "scaler": self.scaler,
                "feature_columns": self.feature_columns,
            }, f)

        meta = {
            "timestamp": time.time(),
            "symbol": symbol,
            "interval": interval,
            "metrics": self.training_metrics,
            "n_features": len(self.feature_columns),
        }
        with open(self._meta_path(symbol, interval), "w") as f:
            json.dump(meta, f, indent=2)

    def load_model(self, symbol: str, interval: str) -> bool:
        """Load a previously trained model from disk. Returns True if successful."""
        path = self._model_path(symbol, interval)
        meta_path = self._meta_path(symbol, interval)

        if not path.exists():
            return False

        # Check if model is stale
        if meta_path.exists():
            with open(meta_path) as f:
                meta = json.load(f)
            age_hours = (time.time() - meta.get("timestamp", 0)) / 3600
            if age_hours > ML["model_max_age_hours"]:
                return False  # Force retrain
            self.training_metrics = meta.get("metrics", {})
            self.model_timestamp = meta.get("timestamp", 0)

        with open(path, "rb") as f:
            data = pickle.load(f)
            self.model = data["model"]
            self.scaler = data["scaler"]
            self.feature_columns = data["feature_columns"]

        self.model_symbol = symbol
        return True

    # =================================================================
    # TRAINING
    # =================================================================

    def train(self, df: pd.DataFrame, symbol: str, interval: str,
              use_optuna: bool = True) -> dict:
        """
        Train an XGBoost classifier on the provided OHLCV DataFrame.
        Returns training metrics dict.
        """
        # Feature engineering
        featured_df = build_features(df)

        # Get feature columns and drop rows with NaN targets
        self.feature_columns = get_feature_columns(featured_df)
        clean_df = featured_df.dropna(subset=["target_direction"] + self.feature_columns)
        clean_df = clean_df.replace([np.inf, -np.inf], 0)

        if len(clean_df) < ML["train_window_min"]:
            return {"error": f"Not enough data: {len(clean_df)} rows, need {ML['train_window_min']}"}

        X = clean_df[self.feature_columns].values
        y = clean_df["target_direction"].values

        # Scale features
        self.scaler = StandardScaler()
        X_scaled = self.scaler.fit_transform(X)

        # Walk-forward validation
        wf_results = self._walk_forward_validate(X_scaled, y, use_optuna)

        # Final model: train on all data with best params
        best_params = wf_results.get("best_params", ML["xgb_defaults"])
        self.model = xgb.XGBClassifier(
            **best_params,
            objective="binary:logistic",
            eval_metric="logloss",
            use_label_encoder=False,
            verbosity=0,
        )
        self.model.fit(X_scaled, y)

        self.training_metrics = {
            "walk_forward_accuracy": wf_results["avg_accuracy"],
            "walk_forward_details": wf_results["fold_results"],
            "total_samples": len(clean_df),
            "n_features": len(self.feature_columns),
            "best_params": {k: (float(v) if isinstance(v, (np.floating,)) else v)
                           for k, v in best_params.items()},
            "trained_at": time.time(),
        }

        # Save model
        self.save_model(symbol, interval)
        self.model_symbol = symbol

        return self.training_metrics

    def _walk_forward_validate(self, X: np.ndarray, y: np.ndarray,
                               use_optuna: bool) -> dict:
        """
        Walk-forward validation: train on expanding window, test on next block.
        Optionally tune hyperparameters with Optuna on the first fold.
        """
        n = len(X)
        test_size = ML["test_window"]
        n_folds = ML["walk_forward_steps"]
        fold_size = test_size

        best_params = dict(ML["xgb_defaults"])
        fold_results = []

        # Optuna tuning on first fold
        if use_optuna:
            try:
                import optuna
                optuna.logging.set_verbosity(optuna.logging.WARNING)

                split_point = n - n_folds * fold_size
                X_tune, y_tune = X[:split_point], y[:split_point]
                X_val, y_val = X[split_point:split_point + fold_size], y[split_point:split_point + fold_size]

                def objective(trial):
                    params = {
                        "n_estimators": trial.suggest_int("n_estimators", 100, 500),
                        "max_depth": trial.suggest_int("max_depth", 3, 10),
                        "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
                        "subsample": trial.suggest_float("subsample", 0.6, 1.0),
                        "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0),
                        "min_child_weight": trial.suggest_int("min_child_weight", 1, 10),
                        "gamma": trial.suggest_float("gamma", 0, 1.0),
                        "reg_alpha": trial.suggest_float("reg_alpha", 0, 1.0),
                        "reg_lambda": trial.suggest_float("reg_lambda", 0.5, 3.0),
                    }
                    m = xgb.XGBClassifier(
                        **params, objective="binary:logistic",
                        eval_metric="logloss", use_label_encoder=False, verbosity=0
                    )
                    m.fit(X_tune, y_tune)
                    return accuracy_score(y_val, m.predict(X_val))

                study = optuna.create_study(direction="maximize")
                study.optimize(objective, n_trials=ML["optuna_n_trials"],
                             timeout=ML["optuna_timeout_seconds"])
                best_params = study.best_params

            except ImportError:
                pass  # Fall back to defaults if optuna not installed

        # Walk-forward folds
        for fold in range(n_folds):
            test_end = n - fold * fold_size
            test_start = test_end - fold_size
            if test_start <= ML["train_window_min"]:
                break

            X_train, y_train = X[:test_start], y[:test_start]
            X_test, y_test = X[test_start:test_end], y[test_start:test_end]

            model = xgb.XGBClassifier(
                **best_params, objective="binary:logistic",
                eval_metric="logloss", use_label_encoder=False, verbosity=0
            )
            model.fit(X_train, y_train)
            preds = model.predict(X_test)
            acc = accuracy_score(y_test, preds)

            cm = confusion_matrix(y_test, preds, labels=[0, 1])
            fold_results.append({
                "fold": fold + 1,
                "train_size": len(X_train),
                "test_size": len(X_test),
                "accuracy": round(float(acc), 4),
                "confusion_matrix": cm.tolist(),
            })

        avg_acc = np.mean([f["accuracy"] for f in fold_results]) if fold_results else 0.5
        return {
            "avg_accuracy": round(float(avg_acc), 4),
            "fold_results": fold_results,
            "best_params": best_params,
        }

    # =================================================================
    # PREDICTION
    # =================================================================

    def predict(self, df: pd.DataFrame, symbol: str, interval: str) -> dict:
        """
        Run ML prediction on OHLCV DataFrame.
        Auto-loads or trains model if needed.
        Returns prediction dict with feature importances and parameters.
        """
        # Ensure model is loaded
        if self.model is None or self.model_symbol != symbol:
            if not self.load_model(symbol, interval):
                # Need to train first
                train_result = self.train(df, symbol, interval)
                if "error" in train_result:
                    return self._fallback_prediction(df, train_result["error"])

        # Feature engineering
        featured_df = build_features(df.copy())
        clean_df = featured_df.replace([np.inf, -np.inf], 0)

        # Ensure all required feature columns exist
        missing_cols = [c for c in self.feature_columns if c not in clean_df.columns]
        for c in missing_cols:
            clean_df[c] = 0

        last_row = clean_df.iloc[-1:]
        X = last_row[self.feature_columns].fillna(0).values

        # Scale
        X_scaled = self.scaler.transform(X)

        # Predict
        direction_prob = self.model.predict_proba(X_scaled)[0]
        predicted_class = int(self.model.predict(X_scaled)[0])
        confidence = float(max(direction_prob))

        # Get feature importances — top 10
        importances = self.model.feature_importances_
        importance_pairs = sorted(
            zip(self.feature_columns, importances),
            key=lambda x: x[1], reverse=True
        )[:10]

        feature_importance_list = []
        for feat_name, imp in importance_pairs:
            feat_value = float(last_row[feat_name].iloc[0]) if feat_name in last_row.columns else 0
            feature_importance_list.append({
                "feature": feat_name,
                "importance": round(float(imp), 4),
                "value": round(feat_value, 4),
            })

        # Build reasons from feature importances
        trend = "UP" if predicted_class == 1 else "DOWN"
        reasons = [
            f"XGBoost Direction: {trend} with {confidence * 100:.1f}% probability",
            f"Model trained on {self.training_metrics.get('total_samples', 'N/A')} samples with {len(self.feature_columns)} features",
            f"Walk-forward accuracy: {self.training_metrics.get('walk_forward_accuracy', 'N/A')}",
            "Top features driving prediction:",
        ]
        for i, fi in enumerate(feature_importance_list[:5], 1):
            reasons.append(
                f"  {i}. {fi['feature']} = {fi['value']} [importance: {fi['importance']}]"
            )

        # Project future prices
        current_price = float(df.iloc[-1]["close"])
        recent_volatility = float(df["close"].pct_change().tail(20).std())
        direction_mult = 1 if predicted_class == 1 else -1
        magnitude = current_price * recent_volatility * confidence * direction_mult

        last_time = int(df.iloc[-1].get("time", 0))
        step = INTERVAL_SECONDS.get(interval, 300)

        future_candles = []
        for i in range(1, 6):
            noise = np.random.normal(0, abs(magnitude) * 0.3)
            projected = round(current_price + magnitude * i + noise, 2)
            future_candles.append({"time": last_time + i * step, "value": projected})

        predicted_price = round(current_price + magnitude * ML["prediction_horizon"], 2)

        return {
            "currentPrice": current_price,
            "predictedPrice": predicted_price,
            "trend": trend,
            "confidence": round(min(0.95, confidence), 2),
            "reasons": reasons,
            "futureCandles": future_candles,
            "source": "xgboost-ml",
            "mode": "ml",
            "featureImportances": feature_importance_list,
            "trainingMetrics": self.training_metrics,
            "indicators": _extract_indicator_values(featured_df),
        }

    def _fallback_prediction(self, df: pd.DataFrame, error: str) -> dict:
        """Fallback when model can't be trained."""
        current_price = float(df.iloc[-1]["close"])
        return {
            "currentPrice": current_price,
            "predictedPrice": current_price,
            "trend": "NEUTRAL",
            "confidence": 0.0,
            "reasons": [f"ML model unavailable: {error}", "Insufficient data for training"],
            "futureCandles": [],
            "source": "xgboost-ml",
            "mode": "ml",
            "featureImportances": [],
            "trainingMetrics": {},
            "indicators": {},
        }


def _extract_indicator_values(df: pd.DataFrame) -> dict:
    """Extract latest indicator values for the response."""
    last = df.iloc[-1]
    indicators = {}
    for col in ["rsi", "macd_line", "macd_signal", "macd_histogram",
                "bb_upper", "bb_lower", "bb_bandwidth", "sma_20", "sma_50",
                "adx", "atr", "volume_ratio", "stoch_rsi_k", "stoch_rsi_d", "roc"]:
        if col in df.columns:
            val = last[col]
            indicators[col] = round(float(val), 4) if not pd.isna(val) else 0
    return indicators


# Singleton instance
_engine = MLEngine()


def predict(df: pd.DataFrame, symbol: str, interval: str) -> dict:
    """Module-level predict function using singleton engine."""
    return _engine.predict(df, symbol, interval)


def train(df: pd.DataFrame, symbol: str, interval: str) -> dict:
    """Module-level train function using singleton engine."""
    return _engine.train(df, symbol, interval)
