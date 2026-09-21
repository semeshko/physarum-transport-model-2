import { DesignWorkerMachine } from "../design/worker-machine";
import { DESIGN_BATCH_DELAY_MS, DESIGN_BATCH_SIZE, DESIGN_PROGRESS_INTERVAL, type DesignWorkerRequest, type DesignWorkerResponse } from "../design/worker-protocol";

const machine = new DesignWorkerMachine();
const workerScope = self as unknown as { onmessage: ((event: MessageEvent<DesignWorkerRequest>) => void) | null; postMessage(message: DesignWorkerResponse): void };
let scheduled = false;

function schedule(): void {
  if (scheduled || !machine.isRunnable) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    const response = machine.stepBatch(DESIGN_BATCH_SIZE);
    if (response && (response.type !== "PROGRESS" || response.state.diagnostics.iteration % DESIGN_PROGRESS_INTERVAL === 0)) workerScope.postMessage(response);
    schedule();
  }, DESIGN_BATCH_DELAY_MS);
}

workerScope.onmessage = (event) => {
  const response = machine.handle(event.data);
  if (response) workerScope.postMessage(response);
  schedule();
};
