import type { Boot } from './bootstrap';
import { Console } from './console';
import { DevBar } from './dev-bar';
import { FailureScreen, SigningInScreen } from './screens';
import { useSignIn } from './use-sign-in';

type ReadyBoot = Extract<Boot, { ok: true }>;

function SignedIn({ boot }: { boot: ReadyBoot }) {
  const mode = boot.launch.mode;
  const { state, retry } = useSignIn(boot.session, mode);
  return (
    <div className="flex min-h-dvh flex-col">
      {mode === 'dev' && boot.persona ? (
        <DevBar api={boot.api} persona={boot.persona} instanceId={boot.launch.devInstanceId} />
      ) : null}
      {state.status === 'pending' ? <SigningInScreen mode={mode} /> : null}
      {state.status === 'failed' ? (
        <FailureScreen
          title={state.problem.title}
          description={state.problem.description}
          reference={state.problem.reference}
          retryAt={state.retryAt}
          onRetry={retry}
        />
      ) : null}
      {state.status === 'ready' ? <Console session={boot.session} auth={state.auth} /> : null}
    </div>
  );
}

/** The Activity: configuration check → sign-in → Mission Control and JVLN Arena. */
export function App({ boot }: { boot: Boot }) {
  if (!boot.ok) {
    return (
      <div className="flex min-h-dvh flex-col">
        <FailureScreen title={boot.problem.title} description={boot.problem.description} />
      </div>
    );
  }
  return <SignedIn boot={boot} />;
}
