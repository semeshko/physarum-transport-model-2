import { PhysarumWorkerMachine } from "../physarum/worker-machine";
import { PHYSARUM_BATCH_DELAY_MS, PHYSARUM_BATCH_SIZE, PHYSARUM_PROGRESS_INTERVAL, type PhysarumWorkerRequest, type PhysarumWorkerResponse } from "../physarum/worker-protocol";

const machine = new PhysarumWorkerMachine();
const workerScope = self as unknown as { onmessage: ((event: MessageEvent<PhysarumWorkerRequest>) => void) | null; postMessage(message: PhysarumWorkerResponse): void };
let scheduled = false;

function schedule(): void {
  if (scheduled || !machine.isRunnable) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    const response = machine.stepBatch(PHYSARUM_BATCH_SIZE);
    if (response && (response.type !== "PROGRESS" || response.state.iteration % PHYSARUM_PROGRESS_INTERVAL === 0)) workerScope.postMessage(response);
    schedule();
  }, PHYSARUM_BATCH_DELAY_MS);
}

workerScope.onmessage = (event) => {
  const response = machine.handle(event.data);
  if (response) workerScope.postMessage(response);
  schedule();
};
