This fork adds a source-only, local-first visual laboratory and documented
compatibility repairs to the original PMTK3 collection:
**https://github.com/hydraxman/pmtk3**. The official upstream remains
https://github.com/probml/pmtk3. Original upstream support status:

**Note: as of 2019, PMTK is no longer supported - use at your own risk.**
The new version of my book (which is in progress) now uses the Python code available from
https://github.com/probml/pyprobml/.




PMTK is a collection of Matlab/Octave functions, written by Matt Dunham, Kevin Murphy and
<a href="https://github.com/probml/pmtk3/wiki/contributingAuthors">various other people</a>. The toolkit is primarily designed to accompany Kevin Murphy's textbook
<a href="http://people.cs.ubc.ca/~murphyk/MLbook">
Machine learning: a probabilistic perspective</a>, but can also be used independently of this book. The goal is to provide a unified conceptual and software framework encompassing machine learning, graphical models, and Bayesian statistics (hence the logo). (Some methods from frequentist statistics, such as cross validation, are also supported.) Since December 2011, the toolbox is in maintenance mode, meaning that bugs will be fixed, but no new features will be added (at least not by Kevin or Matt).

PMTK supports a large
variety of probabilistic models, including
linear and logistic regression models (optionally with kernels), SVMs and gaussian processes, directed and undirected
graphical models,  various kinds of latent variable models (mixtures, PCA, HMMs, etc) , etc.  Several kinds of prior are supported,
including Gaussian (L2 regularization), Laplace (L1 regularization),
Dirichlet, etc.  Many algorithms are supported, for both
Bayesian inference (including dynamic programming,
variational Bayes and MCMC) and MAP/ML estimation (including EM, 
conjugate and projected gradient methods, etc.)

To get the code, click on the "Download zip" button on the right hand side of github, or just clone this repository.


PMTK builds on top of several existing packages, available from
<a href="https://github.com/probml/pmtksupport">pmtksupport</a>,
and provides a unified interface to them. In addition, it provides readable "reference" implementations of many common machine learning techniques. The vast majority of the code is written in Matlab.
 (For a brief discussion of why we chose Matlab, click 
<a href="https://github.com/probml/pmtk3/wiki/WhyMatlab">here</a>.
Most of the code also runs on
<a href="https://github.com/ubcmatlabguide/ubcmatlabguide/wiki/Octave">Octave</a>
an open-source Matlab clone.) However, in a few cases we also provide wrappers to implementations written in C,  for speed reasons. PMTK  has over 67,000 lines.



As you can tell by the name, PMTK3 is the third version of PMTK. Older versions are obsolete, but are briefly described
<a href = "https://github.com/probml/pmtk3/wiki/pmtkVersions">here</a>.

## Chapter-based GitHub Pages

**Open the visual learning atlas: https://hydraxman.github.io/pmtk3/**

The static gallery presents 563 standalone learning routes (511 successful
source-matched Octave originals and 52 separately labelled TypeScript
reproductions), with full-size calculated figures, search, chapter navigation
and mobile layouts. Each chapter includes independently authored concise
Chinese notes, a representative formula, symbol explanations, prerequisites
and questions to guide reading the plots. These notes are not copied or
translated textbook chapters; refer to the
[author's book page](https://probml.github.io/pml-book/book0.html) for the book.

Only the 220 confirmed demo associations in `docs/demoOutput/bookDemos` form
the 25 chapter groups. The 350 remaining source files have a separate section;
editorial learning-topic suggestions are not asserted to be official chapter
memberships. Nonvisual successes remain nonvisual, and alternative methods,
synthetic data and old-framework failures remain explicit.

```powershell
cd web-lab
npm run pages:build
npm run pages:preview
# Open http://127.0.0.1:4184/pmtk3/
npm run pages:test
```

Building the **complete** gallery requires the local `demo-results/inventory.json`
and its successful, current-source original figure captures. The build rejects
missing/stale originals or incomplete learning coverage; it does not substitute
historical screenshots. A clean source checkout can calculate the 52 independent
reproductions using the local-laboratory instructions below, but obtaining all
original captures requires the original runtime/data setup and execution.
The Pages client itself requires no server, Python, MATLAB or Octave.

To republish from the original-results machine, commit source changes, push
the revision to this fork's `master`, then run `.\Publish-Pages.ps1` from the
repository root while signed in to GitHub CLI as the personal fork owner.
The script builds and checks the project-subpath site, pushes generated files
non-forcibly to **`gh-pages`**, configures Pages branch publishing and waits for
the matching public publication manifest. `PAGES_TEST_URL` can point the same
browser checks at the deployed HTTPS site (include the trailing `/pmtk3/`).

Site source lives in `web-lab/pages`, with the exporter in
`web-lab/scripts/build-pages.ts`. Source/default branches do **not** contain
generated output: only the dedicated publishing branch holds content-addressed
PNG/SVG assets and minimal public JSON. Each demo links to immutable source and
records source/image hashes. No runtime paths, raw logs, datasets, credentials
or executables are copied into the public gallery.

## Local web laboratory

### Source-only checkout and recovered visual cases

For the independent visual experiments, **Octave and MATLAB are not required**.
Install Node.js 24 LTS, then run from the repository root:

```powershell
.\Start-Lab.ps1
# Provision/build/compute without starting a server:
.\Start-Lab.ps1 -NoServe
```

This prepares the isolated Python source-inventory tool if necessary, installs
local npm dependencies, builds the UI, computes the 52 reviewed reproductions,
and serves **http://127.0.0.1:4173**. Open **Visual reproductions** in the sidebar,
or open an affected original and select **Run visual reproduction**. Every case
has a seed, named method, disclosed differences, fresh charts, metrics and
numerical checks. Source inventory does not imply the old workloads have run.

The independent TypeScript implementations cover the 24 failed originals, 24
time-bound originals, three safety-blocked workloads and one MATLAB-only
memory-map example from the preceding full sweep. They deliberately do **not**
execute original installers or external crawlers, redistribute MATLAB's `clown`
asset, or turn the original result status green. Synthetic data, educational
workload sizes and changed methods are documented per case. Images and charts
are calculated, not copied from the historical output gallery. The six earlier
adjustable models remain a separate interactive laboratory.

```powershell
cd web-lab
npm run reproduce -- --all
# With a completed original inventory, also require a route for every candidate:
npm run reproduce -- --all --require-coverage
npm run reproduce -- --demo hmmNbestDemo --seed 2026
npx tsx --test tests/reproductions*.test.ts
```

The reproduction CLI writes an offline SVG gallery, numerical JSON, source and
implementation SHA-256 provenance, assertions and coverage under
`web-lab/results/reproductions/seed-42`.
Each CLI invocation has its own attempt directory; the seed-level `index.html`
advances only after the requested computations and coverage checks succeed.
The API provides read-only metadata at
`GET /api/reproductions` and seeded computation at
`GET /api/reproductions/<id>?seed=42`. Original status counts and independent
reproduction coverage are separate claims; mathematical assertions have their
documented finite-fixture scope, not universal certification.

Runtime installations, downloaded support packages, recovered datasets, build
outputs, node_modules, results, logs, screenshots and browser reports are
excluded from new Git changes. Original upstream-tracked reference/data files
remain in upstream history. Commit the harness, numerical implementations,
reviewed compatibility patches, source manifests, setup scripts, tests and lock
file, not the contents of `.demo-runtime`, `demo-results` or `web-lab/results`.

The optional `web-lab` uses Node.js 24, React, TypeScript, Fastify, and a locally
bundled Plotly SVG renderer. From PowerShell:

```powershell
cd C:\Users\shbu\Desktop\pmtk3\web-lab
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4173** (loopback only). `npm run dev` provides the Vite UI
at `http://127.0.0.1:5173` with the API on 4173. `npm test` runs numerical and API
checks; `npm run test:browser` prefers installed Windows Edge (`msedge`), without
downloading another browser, and saves desktop/mobile screenshots under
`web-lab/test-results`. It also performs one fresh original execution and checks
the resulting PNGs. `WEB_LAB_BROWSER_CHANNEL` explicitly overrides browser choice.
`npm run test:queue` checks serialization, duplicate rejection, queued/running
cancellation and a real retry; it cancels only its own submitted jobs.
With `npm start` already running, `npm run test:full` runs the full bounded
web-lab validation sequence.
`npm run --silent numerics` or `GET /api/numerics` emits deterministic default
fixtures for independent cross-engine checks.
`npm run --silent numerics -- --parity` or `GET /api/numerics/parity` provides
fixed comparison inputs/outputs separately from the seeded learning examples.
PCA defaults to population covariance (`N`, matching `pcaPmtk`); sample scaling
is an explicitly labelled option. HMM comparison gamma uses state-by-time order.
`npm run test:parity` (or `GET /api/numerics/parity/check`) checks all six adapters
against the separately generated `demo-results/numerical-reference.json`.
The CLI exits nonzero on missing/invalid reference data or any mismatch; its
verdict is limited to these fixed fixtures, not mathematical validation of all demos.
The explorer also reads dataset audit/recovery metadata through `GET /api/data`;
static audit gaps are shown as review context, not confirmed runtime blockers.
The audit includes recognized `loadFolder`, literal MAT `load` forms, and
support/Octave-statistics MAT files. The batch wrapper explicitly adds the
dynamic yeast references. Optional
per-dataset notes explain builtin, generated-cache, and inactive-branch context.
Availability/recovery totals are read from the current audit, not hardcoded here.

The explorer reads **all** entries in `demo-results/inventory.json`, refreshing
without writing the shared inventory. User runs delegate the existing
`demo-lab/run_demos.py` CLI (120-second demo timeout), serially, into
`web-lab/results`; queue history is in `web-lab/.state`. Python and Octave are
auto-detected under `.demo-runtime`; optional `WEB_LAB_PYTHON` and
`WEB_LAB_OCTAVE` environment variables accept absolute executable paths.
On Windows, bundled `octave-gui.exe` is preferred with `--graphics-toolkit qt`.
The runner supplies `--no-gui` and child-local Qt bundle PATH/plugins,
`QT_QPA_PLATFORM=windows`, and `QT_OPENGL=software`; the web service does not
change global Qt settings. Explicit executable overrides are preserved. For a
Console/gnuplot alternative, set the following before `npm start`:

```powershell
$env:WEB_LAB_OCTAVE = 'C:\Users\shbu\Desktop\pmtk3\.demo-runtime\octave\octave-11.3.0-w64\mingw64\bin\octave-cli.exe'
npm start
# Clear the override before starting again to restore bundled GUI preference:
Remove-Item Env:\WEB_LAB_OCTAVE
```

If no bundled GUI binary is present, initial selection may use Console/gnuplot;
that selection is displayed explicitly. A Qt rendering failure never triggers
a silent Console/gnuplot retry. Console/gnuplot cannot export some modern
scatter objects; those failures remain explicit rather than coerced successes.
The configured next-run engine is separate from
each saved attempt's actual `runtime_profile` (binary, frontend, Qt environment
and path directories); old attempts are not reinterpreted using new defaults.
`WEB_LAB_PORT` changes the production port. No global npm packages,
Docker, accounts, or cloud services are needed.

Six adjustable **independent TypeScript reproductions** cover Beta–Bernoulli,
ordinary/ridge regression, 2D PCA, Gaussian-mixture EM, HMM forward–backward and
Viterbi, and the sprinkler Bayes network. They are not original Octave outputs;
remaining cases are inventoried and, when safe and runnable, executable through
Octave. Historical published images are labelled separately and never count as
current passes. Harness success alone does not prove numerical correctness.
Run trusted original code only: static triage and separate working directories
are not a security sandbox. Mutating API calls require same-origin JSON and the
ephemeral `X-Lab-Token` returned by `GET /api/state`.
While the parent batch lock is active (or cannot be safely inspected), new web
runs return **409 `shared_batch_busy`**, and run/retry controls are disabled.
Inventory, progress, logs, figures, and interactive models remain available.
Queued work is rechecked before launch; busy is not an original-demo failure.
Execution smoke tests must wait for the parent batch to release its lock.
For explicitly read-only browser validation, set `WEB_LAB_READ_ONLY_TESTS=1`
in the test process before `npm run test:browser`; this skips the fresh-original
execution test even if the parent lock disappears during validation.
New harness attempts may expose `path-origins.json` through their artifact links.
Policy `pmtk-semantic-origins-v1` checks function origins and selected setup
semantics; it is not full mathematical certification. Older attempts without
that report are retained unchanged, without an implied setup-check pass.
Web runs explicitly request a **6144 MiB** memory limit (Windows process and
owned-tree committed-memory caps). `resource_limit` is a retryable failure,
never a pass; partial figures/checkpoints remain labelled as non-success
evidence. Attempt details expose recorded memory-guard diagnostics when present.
The explorer's **Eligible to attempt** metric reflects static source/safety/
engine policy only, not a guarantee of runtime support or success. Static blocked
and unsupported policy counts are separate from current execution outcomes.

### Original batch, local data, and portability

From the repository root, the runtime, original-batch, and regression-test entry points are:

```powershell
.\demo-lab\Setup-Runtimes.ps1 -Runtime All
# Defaults: Qt engine, 120 seconds per demo, 6144 MiB process/tree caps:
.\Run-AllDemos.ps1 -Jobs 3
# Resume and also retry prior failures:
.\Run-AllDemos.ps1 -Jobs 3 -TimeoutSeconds 120 -RetryFailed
# Explicit Console/gnuplot alternative:
.\Run-AllDemos.ps1 -Engine Console -Jobs 3 -TimeoutSeconds 120

.\.demo-runtime\python\python.exe .\data-tools\audit_data.py `
  --recover --upstream .\.demo-runtime\data-source `
  --dataset yeastStress --dataset yeastCellCycle

$octave = '.\.demo-runtime\octave\octave-11.3.0-w64\mingw64\bin\octave-cli.exe'
& $octave --no-init-file --no-site-file --no-history --quiet --eval "addpath('data-tools'); verify_models(pwd); test_local_data(pwd); test_kde(pwd);"
```

`Setup-Runtimes.ps1` provisions local Python **3.15.2** with a pinned SHA-256
check and Octave **11.3.0** with GPG verification against a pinned release-signer
fingerprint; it does not require globally installing either runtime.
`Run-AllDemos.ps1` drives the resumable original batch with bounded concurrency;
rerunning resumes unfinished/stale work and retains unchanged completed outcomes.
It also provisions checksum-pinned, isolated Graphviz **16.1.0**, including the
official EPL-2.0 license, through `demo-lab/Setup-Graphviz.ps1`. The executable,
plugins and license are recorded in `.demo-runtime/graphviz/runtime.json`.
Graphviz/Qt/Perl directories are added only to child processes; no global PATH
changes are made. Native numerical execution is also capped with child-local
`OMP_THREAD_LIMIT=1`.
It defaults to **Qt / 120 seconds**, with `-Engine Console` selecting the explicit
Console/gnuplot alternative. `-RetryFailed` also selects previous failed attempts
for retry, including resource-limit failures. The web queue also defaults to
120 seconds, but retains its separate serial queue and isolated output directory.

The batch wrapper prepares the official support/data checkouts as needed.
It recovers **15 historical factor-analysis functions** from the original MIT-
licensed Git revision, retaining the license and a hash manifest in
`legacy-support-recovery.json`. Recorded patches under `data-tools` select
existing pure-code minFunc/L1General implementations when optional MEX files
are absent, and adapt obsolete Netlab callable lookups across optimizers and
samplers, preserving named functions, handles and expression strings. MATLAB
retains its native `fcnchk`; local validation uses Octave, not MATLAB.
The earlier SCG-only patch remains for historical provenance but is not applied
alongside the complete Netlab patch. Explicit `USEMEX` requests remain explicit. A max-times
matrix-product implementation is installed beside its optional KPM MEX:
same-directory native binaries retain priority. Source/template hashes and
patch provenance are retained in `support-patches.json`.
`audit_data.py --recover` preserves recovered official file contents and records
their source commit/path and SHA-256 in `demo-results/data-recovery.json`;
`demo-results/data-audit.json` describes static data availability, including
directory datasets. `verify_models.m` runs six original numerical fixtures and
persists `demo-results/numerical-reference.json`; `test_local_data.m` and
`test_kde.m` exercise local-loader and KDE regressions.
Additional numerical regressions cover quantiles, LARS interpolation,
factor-analysis missing-value prediction, sparse-regression optima, SCG,
max-times multiplication, and exact-enumeration UGM/CRF inference.
`test_overrelaxation.m` checks the existing adaptive EM rejection path with
nonfinite candidates and random restarts. Invalid log-matrix/exponential
candidates are rejected before reaching native LAPACK, without covariance
jitter, reduced data, or a replacement optimization algorithm.

The original SVM classification and regression interfaces use a shared
platform-gated provider: Octave's verified compiled statistics LIBSVM API,
or the existing legacy LIBSVM bindings on MATLAB. LIBLINEAR and SVMlight are
separate providers, not silently replaced. `demo-lab/tests/run_svm_backend.py`
checks classification, SVR, probability ordering, kernels and singleton queries
against the real native provider. Canonical Rosenbrock routing uses an
attempt-local byte-identical source copy rather than promoting an entire
conflicting support directory; its true path, hashes and four-output checks
are recorded in `runtime.json`. Neither check certifies arbitrary models.

Octave KDE portability is intentional: shared `ksdensityPMTK` uses native
MATLAB `ksdensity` when available, otherwise the pre-existing PMTK Botev
diffusion `kde`, with an explicit warning. That fallback uses a different
bandwidth rule and is **not exact MATLAB `ksdensity` parity**. Other source
repairs cover directory-loader options, full image paths, the undefined GMM
random-restart dimension, `ttest` name-value compatibility, floating-grid
tangent selection by nearest index, verified offline prostate CSV data, and
the original contour `Color` → `LineColor` option repairs. `lightingPMTK`
explicitly warns when Octave uses Gouraud instead of unsupported Phong shading;
MATLAB retains Phong. Missing GLMnet is an explicit unsupported outcome for
GLMnet-only demos; optional comparisons in otherwise runnable demos are skipped
with a warning, not substituted with a different algorithm.

### Genuine optional native providers

The local installation additionally has compiled **LIBLINEAR 2.50**, **libDAI
0.3.2**, official **2013-02-15 GLMnet Fortran**, and **SPAMS Matlab 2.6
(2017-02-27)**. These are genuine upstream implementations, not replacement
algorithms. Pinned sources, upstream licenses, compiler/ABI checks, binary hashes
and numerical proofs are retained under `.demo-runtime/native-providers`,
`demo-results-integration/native-providers`, `native-continuation` and
`native-final`. Root MIT licensing does not replace dependency licenses; SPAMS
retains GPLv3-or-later. Historical support-folder names do not identify the
active version: `libdai-0.2.6` contains the verified 0.3.2 provider, and
`SPAMS-1.02/release/win32` contains a verified **64-bit** 2.6 Octave module.
MATLAB-specific native binaries are not overwritten.

Native setup is **optional and separate from `Run-AllDemos.ps1`**. The following
commands assume the bundled runtimes and `pmtksupportCopy` have already been
prepared by the batch wrapper. Run from the repository root with no original
batch or web execution active:

```powershell
$py = '.\.demo-runtime\python\python.exe'
$bin = (Resolve-Path '.\.demo-runtime\octave\octave-11.3.0-w64\mingw64\bin').Path
$oct = Join-Path $bin 'octave-gui.exe'
$builders = @(
  @('.\data-tools\build_native_providers.py', '--family', 'liblinear'),
  @('.\data-tools\build_residual_native.py', '--family', 'libdai'),
  @('.\data-tools\build_glmnet_provider.py'),
  @('.\data-tools\build_spams_provider.py')
)
foreach ($builder in $builders) {
  foreach ($phase in @('fetch', 'build')) {
    & $py @builder --phase $phase --octave-bin $bin
    if ($LASTEXITCODE -ne 0) { throw "Native $phase failed: $builder" }
  }
}
# LIBLINEAR activation is explicit; then verify the installed module:
& $py .\data-tools\build_native_providers.py --family liblinear --phase activate --octave-bin $bin
if ($LASTEXITCODE -ne 0) { throw 'LIBLINEAR activation failed' }
& $py .\data-tools\run_native_liblinear.py --octave $oct
if ($LASTEXITCODE -ne 0) { throw 'LIBLINEAR verification failed' }
# These drivers prove the staged modules before activating them:
& $py .\data-tools\run_native_continuation.py --family libdai --octave $oct --activate-after-proof
if ($LASTEXITCODE -ne 0) { throw 'libDAI verification/activation failed' }
& $py .\data-tools\run_native_continuation.py --family glmnet --octave $oct --activate-after-proof
if ($LASTEXITCODE -ne 0) { throw 'GLMnet verification/activation failed' }
& $py .\data-tools\run_native_spams.py --octave $oct --activate-after-proof
if ($LASTEXITCODE -ne 0) { throw 'SPAMS verification/activation failed' }
```

Activation refuses conflicting unowned files. Replacing an owned GLMnet module
requires an explicit, hash-checked `--replace-owned` request to its builder.
The installed-provider checks can be repeated with `--installed` on the
continuation/SPAMS drivers. Rerun dependent originals after installing a
provider: source-only resume hashes do not track every transitive binary
change. Native LIBLINEAR classification tests cover genuine squared-hinge
optima, label/tie behavior and sparse input; they do not claim regression or
probability support. libDAI is checked against independent enumeration, including
Windows LLP64 full-width labels. SPAMS uses an explicitly serial build
(`-fno-openmp` with a compile-time guard); the original dictionary-learning
workload is not shortened. Reviewed SPAMS gateway coverage is dense real-double
input, and GLMnet sparse/Poisson/Cox interfaces are not claimed verified.

The 2013 GLMnet core counts **coordinate-descent passes across a whole path**,
not the old logistic solver's per-lambda outer iterations. There is no fixed
unit conversion. `glmnetDemoOptions()` explicitly configures **100000
whole-path passes** for the selected Octave demonstrations, emits the chosen
budget and preserves other defaults, including the original kernel
standardization choices. MATLAB keeps its existing options. Direct callers can
set `options.octave_max_passes`; `fit.octave_budget` records the limit, actual
passes, requested/completed lambdas and native `jerr`. Independent L1, true-ridge,
binomial, multinomial and CV fixtures use
`options.octave_require_complete = true`: both `jerr=0` and every requested
lambda are required, and a one-pass budget is demonstrably rejected rather
than inflated. Strict completeness also rejects legitimate native automatic
path early stopping; the original demonstration presets preserve that stopping
behavior. Partial-path warnings are not evidence of full convergence.

### Additional compatibility and remaining limits

Recorded support patches now also select existing pure-code UGM constructors
and generators on Octave while retaining explicit MEX requests, repair abstract
method syntax, and separate legacy GLMnet error-bar styling from numeric data.
The recovered official `UGM_MFGibbsFreeEnergy` and licensed pure-code L1
projection are checked against independent enumeration/free-energy and KKT
contracts. Native source restoration and support patches use separate
conflict-checked installers; they do not silently overwrite unrelated edits.

Graphviz exports real PDF and optional upright, larger PNG figure previews while
preserving DOT source; PDF page rotation does not rotate preview labels.
`ggmLassoDemo`, `sparseNnetDemo` and `visualizeAlarmNetwork` use an explicitly
labelled **static** Graphviz display only when Octave lacks MATLAB
`dynamicprops`; their numerical computations and MATLAB graph-object branches
remain intact. Both a warning and a visible figure footer disclose that MATLAB
graph-object editing is unavailable. This is not a fake dynamic-properties
class. Additional repairs cover current RVM named-kernel calls, explicit GPR
covariance arguments, OLS-with-intercept R-squared, LAD bound-vector orientation,
QP zero-margin decisions, image/word-list indexing and graphics stacking.
The original logistic posterior example retains its 5000 MH samples.
Variational-Bayes publishing uses real Octave redraws in place of MATLAB-only
`snapnow`; its 200-iteration maximum is unchanged. Gaussian-process sample
legends use the equivalent named location. Shrunken-centroid gene-count ticks
are aligned with their actual sampled lambda values on the same axis limits;
a gene is counted once when any class selects it, rather than counting
class-by-gene coefficients as separate genes.
The VAN example retains its original optimization; when `ds2nfu` is absent, a
warning-labelled, unscaled `quiver` draws the same arrow endpoints in data
coordinates rather than pretending to provide the missing annotation utility.

Not every remaining failure is a dependency problem. Some require MATLAB-only
APIs or nonredistributable built-in data (`clown`); some historical examples
are unfinished or numerically invalid; others exceed their recorded time or
memory budget. Octave's principal-axis `factoran` is not substituted for
MATLAB's maximum-likelihood factor analysis. The unfinished SCAD helper is not
relabelled as a working SCAD algorithm by merely fixing its argument container.
Hyvarinen's TIFF images and `pmtkImages` were already bundled, not recovered
downloads. The data audit distinguishes optional result caches and inactive
MNIST alternatives from actual missing runtime data. Existing questionable
historical formulas are not universally certified by successful execution.

**570 original source files does not mean 570 runnable standalone demos.**
There are 563 runnable candidates (532 main demos and 31 legacy tests), plus
seven helpers. The published output links 220 unique demonstrations across
25 chapters; the remaining source files have no confirmed published chapter
mapping. Read current execution totals from the inventory/progress and the
web explorer. Finished attempts are not all passes, and a timeout is only a
configured time-bound outcome. Six passing fixed numerical
fixtures do not establish mathematical correctness for every demo or parameter
regime, and a harness success is not a full numerical-certification verdict.
Octave-unsupported workloads are explicitly **not executed**, never counted as
passes, and cannot be queued or retried through the web API. For example,
`memoryMapDemo` requires MATLAB `memmapfile`; its leading Octave return is not a
nonvisual success. Old attempt files remain evidence, not current pass claims.
