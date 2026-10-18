import { describe, expect, it } from 'vitest';
import { Action, type ActionBinding, type InstanceEvent, type InstanceHandle } from './index.js';
import { Control, newHost, OtherKind, renderInstance, type ControlEvents } from './fake-adapter.test-support.js';

/** Attaches through the setup seam the way an application does, and returns what it bound. */
function bindOne(
  host: ReturnType<typeof newHost>,
  id: string,
  bind: (handle: InstanceHandle<ControlEvents>) => ActionBinding,
): ActionBinding {
  let binding: ActionBinding | undefined;
  host.register((view) => {
    view.watchById(id, Control, (handle) => {
      binding = bind(handle);
    });
  });
  if (binding === undefined) throw new Error(`no instance ${id} was discovered`);
  return binding;
}

describe('a synchronous local action bound to a rendered instance', () => {
  it('runs its handler once per press, with the input read from the pressing instance', () => {
    const host = newHost();
    const seen: unknown[] = [];
    const save = Action.local<InstanceEvent<string>>('save')
      .input((event) => ({ id: event.read('id'), at: event.dataPath }))
      .run(({ params }) => {
        seen.push(params);
      })
      .build();
    const row = renderInstance(host, 'row-save', { dataPath: '/rows/1', data: { id: 'n-2' } });
    bindOne(host, 'row-save', (handle) => handle.bindAction('activate', save));

    expect(row.press()).toBe('started');

    expect(seen).toEqual([{ id: 'n-2', at: '/rows/1' }]);
  });

  it('does nothing while no action is bound to the pressed instance', () => {
    const host = newHost();
    const control = renderInstance(host, 'idle-control');

    expect(control.press()).toBe('unbound');
  });

  it('finishes runtime finalization and returns to idle before the event handler returns', () => {
    const host = newHost();
    const phases: string[] = [];
    const toggle = Action.local<InstanceEvent<string>>('toggle')
      .run(() => {
        phases.push('handler');
      })
      .build();
    const control = renderInstance(host, 'toggle');
    const binding = bindOne(host, 'toggle', (handle) => handle.bindAction('activate', toggle));
    binding.subscribe(() => phases.push(binding.state.phase));

    expect(binding.state.phase).toBe('idle');
    control.press();

    expect(phases).toEqual(['running', 'handler', 'settling', 'idle']);
    expect(binding.state.phase).toBe('idle');
  });

  it('replaces the state object on every change and never mutates one that was handed out', () => {
    const host = newHost();
    const control = renderInstance(host, 'c');
    const toggle = Action.local<InstanceEvent<string>>('toggle').run(() => undefined).build();
    const binding = bindOne(host, 'c', (handle) => handle.bindAction('activate', toggle));
    const before = binding.state;

    control.press();

    expect(binding.state).not.toBe(before);
    expect(before.phase).toBe('idle');
  });
});

const toggle = () => Action.local<InstanceEvent<string>>('toggle').run(() => undefined).build();

describe('one instance and event admits one live binding', () => {
  it('refuses a second binding while the first is live, and the first keeps running', () => {
    const errors: unknown[] = [];
    const host = newHost((error) => errors.push(error));
    const runs: string[] = [];
    const first = Action.local<InstanceEvent<string>>('first').run(() => void runs.push('first')).build();
    const second = Action.local<InstanceEvent<string>>('second').run(() => void runs.push('second')).build();
    const control = renderInstance(host, 'c');
    const firstBinding = bindOne(host, 'c', (handle) => handle.bindAction('activate', first));

    // A second setup tries to claim the same event; its discovery callback fails and is reported.
    host.register((view) => view.watchById('c', Control, (handle) => void handle.bindAction('activate', second)));
    control.press();

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/already has a live binding/);
    expect(runs).toEqual(['first']);
    expect(firstBinding.state.phase).toBe('idle');
  });

  it('names the failure when a handle binds a second time directly', () => {
    const host = newHost();
    renderInstance(host, 'c');
    let handle: InstanceHandle<ControlEvents> | undefined;
    host.register((view) => view.watchById('c', Control, (h) => (handle = h)));
    handle!.bindAction('activate', toggle());

    expect(() => handle!.bindAction('activate', toggle())).toThrow(/already has a live binding/);
  });

  it('refuses an event the instance does not offer, naming it', () => {
    const host = newHost();
    renderInstance(host, 'c');
    let handle: InstanceHandle<ControlEvents> | undefined;
    host.register((view) => view.watchById('c', Control, (h) => (handle = h)));

    expect(() => handle!.bindAction('hover' as 'activate', toggle())).toThrow(/does not offer the event 'hover'/);
  });

  it('refuses a value that Action did not build', () => {
    const host = newHost();
    renderInstance(host, 'c');
    let handle: InstanceHandle<ControlEvents> | undefined;
    host.register((view) => view.watchById('c', Control, (h) => (handle = h)));
    const forged = { label: 'forged' };

    expect(() => handle!.bindAction('activate', forged)).toThrow(/not an action definition/);
    expect(renderInstance(host, 'd').press()).toBe('unbound');
  });

  it('disposes idempotently, stops running, and lets the same live handle bind again', () => {
    const host = newHost();
    const runs: string[] = [];
    const first = Action.local<InstanceEvent<string>>('first').run(() => void runs.push('first')).build();
    const second = Action.local<InstanceEvent<string>>('second').run(() => void runs.push('second')).build();
    const control = renderInstance(host, 'c');
    let handle: InstanceHandle<ControlEvents> | undefined;
    host.register((view) => view.watchById('c', Control, (h) => (handle = h)));
    const firstBinding = handle!.bindAction('activate', first);
    const states: string[] = [];
    firstBinding.subscribe(() => states.push(firstBinding.state.phase));

    firstBinding.dispose();
    firstBinding.dispose();
    expect(states).toEqual(['disposed']);
    expect(control.press()).toBe('unbound');

    const secondBinding = handle!.bindAction('activate', second);
    firstBinding.dispose(); // the old cleanup running late must not detach its successor
    control.press();

    expect(runs).toEqual(['second']);
    expect(firstBinding.state.phase).toBe('disposed');
    expect(secondBinding.state.phase).toBe('idle');
  });

  it('keeps bindings of one definition on different instances independent', () => {
    const host = newHost();
    const seen: string[] = [];
    const whileRunning: string[] = [];
    let others: () => string = () => '';
    const archive = Action.local<InstanceEvent<string>>('archive')
      .input((event) => String(event.read('id')))
      .run(({ params }) => {
        seen.push(params);
        whileRunning.push(others());
      })
      .build();
    const rowA = renderInstance(host, 'row', { dataPath: '/rows/0', data: { id: 'a' } });
    const rowB = renderInstance(host, 'row', { dataPath: '/rows/1', data: { id: 'b' } });
    const bindings: ActionBinding[] = [];
    host.register((view) => view.watchById('row', Control, (h) => bindings.push(h.bindAction('activate', archive))));
    const [bindingA, bindingB] = bindings as [ActionBinding, ActionBinding];
    const phasesOfA: string[] = [];
    bindingA.subscribe(() => phasesOfA.push(bindingA.state.phase));

    others = () => bindingB.state.phase; // B is untouched while A runs
    rowA.press();
    expect(phasesOfA).toEqual(['running', 'settling', 'idle']);
    phasesOfA.length = 0;
    rowB.press();

    expect(seen).toEqual(['a', 'b']);
    expect(whileRunning[0]).toBe('idle');
    expect(phasesOfA).toEqual([]);
    expect(bindingA.id).not.toBe(bindingB.id);
  });

  it('drops an activation that arrives while the same binding is still running', () => {
    const host = newHost();
    let runs = 0;
    let control!: ReturnType<typeof renderInstance>;
    const reentrant = Action.local<InstanceEvent<string>>('reentrant')
      .run(() => {
        runs += 1;
        control.press();
      })
      .build();
    control = renderInstance(host, 'c');
    bindOne(host, 'c', (handle) => handle.bindAction('activate', reentrant));

    control.press();

    expect(runs).toBe(1);
  });
});

describe('discovery by component ID', () => {
  it('getById returns the one instance of that ID and kind', () => {
    const host = newHost();
    renderInstance(host, 'save');
    let id: string | undefined;
    host.register((view) => {
      id = view.getById('save', Control).id;
    });

    expect(id).toBe('save');
  });

  it('getById fails for no instance, for several, and for another kind, naming the ID', () => {
    const host = newHost();
    renderInstance(host, 'row', { dataPath: '/rows/0' });
    renderInstance(host, 'row', { dataPath: '/rows/1' });
    renderInstance(host, 'other', { kind: OtherKind });

    host.register((view) => {
      expect(() => view.getById('missing', Control)).toThrow(/'missing'/);
      expect(() => view.getById('row', Control)).toThrow(/2 rendered instances.*'row'/);
      expect(() => view.getById('other', Control)).toThrow(/'other'/);
    });
  });

  it('watchById reaches present and later instances once each, and each press reaches only its own instance', () => {
    const host = newHost();
    const pressed: string[] = [];
    const archive = Action.local<InstanceEvent<string>>('archive')
      .input((event) => `${event.dataPath}:${String(event.read('id'))}`)
      .run(({ params }) => void pressed.push(params))
      .build();
    const first = renderInstance(host, 'row', { dataPath: '/rows/0', data: { id: 'a' } });
    let delivered = 0;
    host.register((view) =>
      view.watchById('row', Control, (handle) => {
        delivered += 1;
        handle.bindAction('activate', archive);
      }),
    );
    const later = renderInstance(host, 'row', { dataPath: '/rows/1', data: { id: 'b' } });
    renderInstance(host, 'unrelated');

    later.press();
    first.press();

    expect(delivered).toBe(2);
    expect(pressed).toEqual(['/rows/1:b', '/rows/0:a']);
  });

  it('delivers handles with the instance data path and a live reader that answers undefined after retirement', () => {
    const host = newHost();
    const row = renderInstance(host, 'row', { dataPath: '/rows/3', data: { id: 'n-3' } });
    let handle: InstanceHandle<ControlEvents> | undefined;
    host.register((view) => view.watchById('row', Control, (h) => (handle = h)));

    expect([handle!.dataPath, handle!.read('id')]).toEqual(['/rows/3', 'n-3']);
    row.destroy();
    expect(handle!.read('id')).toBeUndefined();
  });

  it('unsubscribing discovery stops new handles but disposes no binding; ending the registration does', () => {
    const host = newHost();
    const runs: string[] = [];
    const action = Action.local<InstanceEvent<string>>('a').run(() => void runs.push('ran')).build();
    const early = renderInstance(host, 'row', { dataPath: '/rows/0' });
    let stopDiscovery!: () => void;
    const endRegistration = host.register((view) => {
      stopDiscovery = view.watchById('row', Control, (handle) => void handle.bindAction('activate', action));
    });

    stopDiscovery();
    const late = renderInstance(host, 'row', { dataPath: '/rows/1' });
    early.press();
    expect(runs).toEqual(['ran']);
    expect(late.press()).toBe('unbound');

    endRegistration();
    expect(early.press()).toBe('unbound');
  });
});

describe('instance lifetime', () => {
  it('retiring an instance disposes its bindings once and makes its handles stale', () => {
    const host = newHost();
    const control = renderInstance(host, 'c');
    let handle: InstanceHandle<ControlEvents> | undefined;
    host.register((view) => view.watchById('c', Control, (h) => (handle = h)));
    const binding = handle!.bindAction('activate', toggle());
    const states: string[] = [];
    binding.subscribe(() => states.push(binding.state.phase));

    control.destroy();
    control.destroy();

    expect(states).toEqual(['disposed']);
    expect(control.press()).toBe('retired');
    expect(() => handle!.bindAction('activate', toggle())).toThrow(/stale/);
  });

  it('after the renderer recreates a component, the old handle fails and the new instance starts unbound and idle', () => {
    const host = newHost();
    const old = renderInstance(host, 'c');
    const handles: InstanceHandle<ControlEvents>[] = [];
    host.register((view) => view.watchById('c', Control, (h) => handles.push(h)));
    const oldBinding = handles[0]!.bindAction('activate', toggle());

    old.destroy();
    const recreated = renderInstance(host, 'c');

    expect(handles).toHaveLength(2);
    expect(() => handles[0]!.bindAction('activate', toggle())).toThrow(/stale/);
    expect(recreated.press()).toBe('unbound');
    const newBinding = handles[1]!.bindAction('activate', toggle());
    expect(newBinding.state.phase).toBe('idle');
    expect(newBinding.id).not.toBe(oldBinding.id);
  });

  it('refuses a press once the instance is no longer live, before the renderer has retired it', () => {
    const host = newHost();
    let runs = 0;
    const action = Action.local<InstanceEvent<string>>('a').run(() => void (runs += 1)).build();
    const control = renderInstance(host, 'c');
    bindOne(host, 'c', (handle) => handle.bindAction('activate', action));

    control.goStale();

    expect(control.press()).toBe('retired');
    expect(runs).toBe(0);
  });

  it('answers event.read only while the event is being delivered', () => {
    const host = newHost();
    let kept: InstanceEvent<string> | undefined;
    const capture = Action.local<InstanceEvent<string>>('capture')
      .input((event) => {
        kept = event;
        return event.read('id');
      })
      .run(() => undefined)
      .build();
    const control = renderInstance(host, 'c', { data: { id: 'x' } });
    bindOne(host, 'c', (handle) => handle.bindAction('activate', capture));

    control.press();

    expect(() => kept!.read('id')).toThrow(/only while the event is being delivered/);
  });
});

describe('setup ownership', () => {
  it('a setup that throws ends its registration, disposes what it bound, and propagates', () => {
    const host = newHost();
    const control = renderInstance(host, 'c');
    const failure = new Error('setup failed');

    expect(() =>
      host.register((view) => {
        view.watchById('c', Control, (handle) => void handle.bindAction('activate', toggle()));
        throw failure;
      }),
    ).toThrow(failure);

    expect(control.press()).toBe('unbound');
  });

  it('a discovery callback that throws loses only its own bindings and reports to the setup error sink', () => {
    const errors: unknown[] = [];
    const host = newHost((error) => errors.push(error));
    const ok = renderInstance(host, 'ok');
    const bad = renderInstance(host, 'bad');
    const failure = new Error('callback failed');
    host.register((view) => {
      view.watchById('ok', Control, (handle) => void handle.bindAction('activate', toggle()));
      view.watchById('bad', Control, (handle) => {
        handle.bindAction('activate', toggle());
        throw failure;
      });
    });

    expect(errors).toEqual([failure]);
    expect(bad.press()).toBe('unbound');
    expect(ok.press()).toBe('started');
  });

  it('close() ends every registration and retires every instance; later open and register do nothing', () => {
    const host = newHost();
    const control = renderInstance(host, 'c');
    bindOne(host, 'c', (handle) => handle.bindAction('activate', toggle()));

    host.close();
    host.close();
    let setupRan = false;
    host.register(() => void (setupRan = true));
    const afterClose = renderInstance(host, 'late');

    expect(control.press()).toBe('retired');
    expect(afterClose.press()).toBe('retired');
    expect(setupRan).toBe(false);
  });

  it('a handle kept from an ended registration can no longer bind', () => {
    const host = newHost();
    renderInstance(host, 'c');
    let kept: InstanceHandle<ControlEvents> | undefined;
    const end = host.register((view) => view.watchById('c', Control, (h) => (kept = h)));

    end();

    expect(() => kept!.bindAction('activate', toggle())).toThrow(/stale/);
  });
});

describe('failures of an invocation', () => {
  it('finishes the invocation, returns to idle, then rethrows the handler error to the event caller', () => {
    const host = newHost();
    const failure = new Error('boom');
    const action = Action.local<InstanceEvent<string>>('boom').run(() => {
      throw failure;
    }).build();
    const control = renderInstance(host, 'c');
    const binding = bindOne(host, 'c', (handle) => handle.bindAction('activate', action));

    expect(() => control.press()).toThrow(failure);
    expect(binding.state.phase).toBe('idle');
  });

  it('does not run the handler when the input extractor throws', () => {
    const host = newHost();
    let ran = false;
    const action = Action.local<InstanceEvent<string>>('input')
      .input((): string => {
        throw new Error('bad input');
      })
      .run(() => void (ran = true))
      .build();
    const control = renderInstance(host, 'c');
    bindOne(host, 'c', (handle) => handle.bindAction('activate', action));

    expect(() => control.press()).toThrow('bad input');
    expect(ran).toBe(false);
  });

  it('refuses a promise that the types did not show, without leaving an unhandled rejection', async () => {
    const host = newHost();
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', record);
    try {
      const hidden: unknown = Promise.reject(new Error('late'));
      const action = Action.local<InstanceEvent<string>>('hidden')
        .run(() => hidden as undefined)
        .build();
      const control = renderInstance(host, 'c');
      const binding = bindOne(host, 'c', (handle) => handle.bindAction('activate', action));

      expect(() => control.press()).toThrow(/returned a promise/);
      expect(binding.state.phase).toBe('idle');
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', record);
    }
  });

  it('a listener that throws does not affect the action', () => {
    const host = newHost();
    let runs = 0;
    const action = Action.local<InstanceEvent<string>>('a').run(() => void (runs += 1)).build();
    const control = renderInstance(host, 'c');
    const binding = bindOne(host, 'c', (handle) => handle.bindAction('activate', action));
    binding.subscribe(() => {
      throw new Error('listener');
    });

    expect(() => control.press()).not.toThrow();
    expect(runs).toBe(1);
    expect(binding.state.phase).toBe('idle');
  });

  it('stays disposed when the handler disposes its own binding', () => {
    const host = newHost();
    let binding!: ActionBinding;
    const action = Action.local<InstanceEvent<string>>('self-dispose').run(() => binding.dispose()).build();
    const control = renderInstance(host, 'c');
    binding = bindOne(host, 'c', (handle) => handle.bindAction('activate', action));

    control.press();

    expect(binding.state.phase).toBe('disposed');
    expect(control.press()).toBe('unbound');
  });
});

describe('the immutable builder', () => {
  it('treats a retained alias as a branch, so two definitions never see each other', () => {
    const host = newHost();
    const ran: string[] = [];
    const alias = Action.local<InstanceEvent<string>>('branch').input(() => 'p');
    const one = alias.run(({ params }) => void ran.push(`one:${params}`)).build();
    const two = alias.run(({ params }) => void ran.push(`two:${params}`)).build();
    const a = renderInstance(host, 'a');
    const b = renderInstance(host, 'b');
    host.register((view) => {
      view.getById('a', Control).bindAction('activate', one);
      view.getById('b', Control).bindAction('activate', two);
    });

    a.press();
    b.press();

    expect(ran).toEqual(['one:p', 'two:p']);
  });

  it('refuses a repeated or misordered step even when the types are bypassed', () => {
    const draft = Action.local<InstanceEvent<string>>('x') as unknown as Record<string, (...args: unknown[]) => unknown>;
    const afterInput = draft.input!(() => 1) as Record<string, (...args: unknown[]) => unknown>;
    const withHandler = afterInput.run!(() => undefined) as Record<string, (...args: unknown[]) => unknown>;

    expect(() => afterInput.input!(() => 2)).toThrow(/input can be declared once/);
    expect(() => withHandler.run!(() => undefined)).toThrow(/run can be declared once/);
    expect(() => withHandler.input!(() => 2)).toThrow(/input can be declared once/);
    expect(() => draft.build!()).toThrow(/before run/);
    expect(() => Action.local('')).toThrow(/label/);
  });
});

// Type-level cases. These lines are checked by `npm run typecheck`, not at runtime.
describe('what the types refuse', () => {
  it('rejects asynchronous input and handlers, unknown events, and a definition for the wrong event', () => {
    // @ts-expect-error an async handler is a later slice
    Action.local<InstanceEvent<string>>('async-run').run(async () => undefined);
    // @ts-expect-error an async input extractor
    Action.local<InstanceEvent<string>>('async-input').input(async () => 1);
    // @ts-expect-error a union with a promise is still asynchronous
    Action.local<InstanceEvent<string>>('union').run((): Promise<number> | undefined => undefined);
    // An always-throwing handler returns never and stays valid.
    Action.local<InstanceEvent<string>>('throws').run(() => {
      throw new Error('x');
    });

    const needsNumber = Action.local<{ readonly value: number }>('needs-number').run(() => undefined).build();
    const host = newHost();
    renderInstance(host, 'c');
    host.register((view) => {
      view.watchById('c', Control, (handle) => {
        // @ts-expect-error the instance does not offer this event
        handle.bindAction('hover', toggle());
        // @ts-expect-error this definition needs an event the control does not deliver
        handle.bindAction('activate', needsNumber);
        // @ts-expect-error a handler context carries params and nothing else yet
        Action.local<InstanceEvent<string>>('ctx').run(({ signal }) => signal);
        // @ts-expect-error prerequisites are a later slice and are not declared
        Action.local<InstanceEvent<string>>('later').before;
        // @ts-expect-error hooks and limits are a later slice and are not declared
        Action.local<InstanceEvent<string>>('later').run(() => undefined).limits;
        // @ts-expect-error bindAction takes no options yet
        handle.bindAction('activate', toggle(), { subject: () => 1 });
      });
    });
  });
});
