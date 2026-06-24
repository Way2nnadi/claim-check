import type { GuidedTourStep } from "./navigation";

interface GuidedTourRailProps {
	steps: readonly GuidedTourStep[];
	activeStepIndex: number;
	onGoToStep: (stepIndex: number) => void;
	onDismiss: () => void;
}

export default function GuidedTourRail({
	steps,
	activeStepIndex,
	onGoToStep,
	onDismiss,
}: GuidedTourRailProps) {
	const activeStep = steps[activeStepIndex];
	const isFirstStep = activeStepIndex === 0;
	const isLastStep = activeStepIndex === steps.length - 1;

	if (!activeStep) {
		return null;
	}

	return (
		<aside className="guided-tour-rail reveal" aria-label="Guided product tour">
			<div className="guided-tour-rail-head">
				<div className="guided-tour-copy">
					<span className="guided-tour-kicker" aria-live="polite">
						Guided tour · Step {activeStepIndex + 1} of {steps.length}
					</span>
					<p className="guided-tour-title">{activeStep.title}</p>
					<p className="guided-tour-summary">{activeStep.summary}</p>
				</div>
			</div>

			<ol className="guided-tour-track" aria-label="Tour steps">
				{steps.map((step, index) => {
					const state =
						index === activeStepIndex
							? "current"
							: index < activeStepIndex
								? "complete"
								: "upcoming";
					const lineState = index < activeStepIndex ? "complete" : "upcoming";
					return (
						<li key={step.sectionId} className="guided-tour-track-item">
							<button
								type="button"
								className={`guided-tour-marker is-${state}`}
								aria-label={`Step ${index + 1}: ${step.title}`}
								aria-current={index === activeStepIndex ? "step" : undefined}
								onClick={() => onGoToStep(index)}
							>
								<span aria-hidden="true">{index + 1}</span>
							</button>
							{index < steps.length - 1 ? (
								<span
									className={`guided-tour-track-line is-${lineState}`}
									aria-hidden="true"
								/>
							) : null}
						</li>
					);
				})}
			</ol>

			<div className="guided-tour-footer">
				<div className="guided-tour-nav">
					<button
						type="button"
						className="guided-tour-btn"
						disabled={isFirstStep}
						onClick={() => onGoToStep(activeStepIndex - 1)}
					>
						Previous
					</button>
					<button
						type="button"
						className="guided-tour-btn guided-tour-btn-primary"
						onClick={() => {
							if (isLastStep) {
								onDismiss();
								return;
							}
							onGoToStep(activeStepIndex + 1);
						}}
					>
						{isLastStep ? "Finish tour" : "Next step"}
					</button>
				</div>
				<button
					type="button"
					className="guided-tour-dismiss"
					onClick={onDismiss}
				>
					Exit tour
				</button>
			</div>
		</aside>
	);
}
