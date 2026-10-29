"""Tiny deterministic analytic contracts, NOT translations of original demos.

Pure stdlib references are explicitly distinguished from real Octave results.
Inputs and JSON outputs can be reused by other numerical engines / the web UI.
"""
from __future__ import annotations

import math


def beta_posterior(p: dict) -> dict:
    a = p["prior"][0] + p["successes"]
    b = p["prior"][1] + p["failures"]
    density = [math.exp(math.lgamma(a+b)-math.lgamma(a)-math.lgamma(b)
                        + (a-1)*math.log(x) + (b-1)*math.log1p(-x)) for x in p["grid"]]
    return {"posterior": [a, b], "mean": a/(a+b),
            "variance": a*b/((a+b)**2*(a+b+1)), "density": density}


def solve2(a: list[list[float]], b: list[float]) -> list[float]:
    det = a[0][0]*a[1][1] - a[0][1]*a[1][0]
    if abs(det) < 1e-14:
        raise ValueError("Singular 2x2 fixture")
    return [(b[0]*a[1][1]-a[0][1]*b[1])/det, (a[0][0]*b[1]-b[0]*a[1][0])/det]


def ols_ridge(p: dict) -> dict:
    x, y = p["x"], p["y"]
    gram = [[sum(row[i]*row[j] for row in x) for j in range(2)] for i in range(2)]
    rhs = [sum(row[i]*target for row, target in zip(x, y)) for i in range(2)]
    ols = solve2(gram, rhs)
    penalized = [gram[0][:], [gram[1][0], gram[1][1]+p["lambda"]]]
    ridge = solve2(penalized, rhs)
    return {"ols": ols, "ridge": ridge,
            "ols_predictions": [sum(a*b for a, b in zip(row, ols)) for row in x],
            "ridge_predictions": [sum(a*b for a, b in zip(row, ridge)) for row in x]}


def pca2d(p: dict) -> dict:
    x = p["x"]
    mean = [sum(row[j] for row in x)/len(x) for j in range(2)]
    cov = [[sum((r[i]-mean[i])*(r[j]-mean[j]) for r in x)/(len(x)-1)
            for j in range(2)] for i in range(2)]
    delta = math.sqrt((cov[0][0]-cov[1][1])**2 + 4*cov[0][1]**2)
    eigenvalues = [(cov[0][0]+cov[1][1]+delta)/2, (cov[0][0]+cov[1][1]-delta)/2]
    projector = [[(cov[i][j]-(eigenvalues[1] if i == j else 0))/delta
                  for j in range(2)] for i in range(2)]
    return {"mean": mean, "covariance": cov, "eigenvalues": eigenvalues,
            "principal_projector": projector}  # invariant to eigenvector sign


def mixture_em(p: dict) -> dict:
    x = p["x"]
    means, variances, weights = p["means"][:], p["variances"][:], p["weights"][:]

    def expectation():
        rows, loglik = [], 0.0
        for value in x:
            terms = [weights[k]*math.exp(-.5*(value-means[k])**2/variances[k])
                     / math.sqrt(2*math.pi*variances[k]) for k in range(2)]
            total = sum(terms)
            rows.append([term/total for term in terms])
            loglik += math.log(total)
        return rows, loglik

    history = []
    for _ in range(p["iterations"]):
        resp, _ = expectation()
        mass = [sum(row[k] for row in resp) for k in range(2)]
        means = [sum(resp[i][k]*value for i, value in enumerate(x))/mass[k] for k in range(2)]
        variances = [max(p["variance_floor"], sum(resp[i][k]*(value-means[k])**2
                         for i, value in enumerate(x))/mass[k]) for k in range(2)]
        weights = [value/len(x) for value in mass]
        history.append(expectation()[1])
    responsibilities, _ = expectation()
    return {"means": means, "variances": variances, "weights": weights,
            "responsibilities": responsibilities, "log_likelihood_history": history}


def hmm_forward_backward(p: dict) -> dict:
    transition, emission, observations = p["transition"], p["emission"], p["observations"]
    alpha, scales = [], []
    for t, observation in enumerate(observations):
        prediction = p["initial"] if t == 0 else [
            sum(alpha[t-1][i]*transition[i][j] for i in range(2)) for j in range(2)]
        row = [prediction[j]*emission[j][observation] for j in range(2)]
        scale = sum(row)
        scales.append(scale)
        alpha.append([v/scale for v in row])
    beta = [[1.0, 1.0] for _ in observations]
    for t in range(len(observations)-2, -1, -1):
        beta[t] = [sum(transition[i][j]*emission[j][observations[t+1]]*beta[t+1][j]
                       for j in range(2))/scales[t+1] for i in range(2)]
    posterior = []
    for a, b in zip(alpha, beta):
        row = [a[j]*b[j] for j in range(2)]
        posterior.append([v/sum(row) for v in row])
    return {"alpha": alpha, "beta": beta, "posterior": posterior,
            "log_evidence": sum(math.log(s) for s in scales)}


def sprinkler(p: dict) -> dict:
    joint, wet, rain_wet = [], 0.0, 0.0
    for cloudy in range(2):
        for spray in range(2):
            for rain in range(2):
                pc = p["cloudy"] if cloudy else 1-p["cloudy"]
                ps = p["sprinkler_given_cloudy"][cloudy]
                pr = p["rain_given_cloudy"][cloudy]
                pw = p["wet_given_sprinkler_rain"][spray][rain]
                for water in range(2):
                    probability = pc*(ps if spray else 1-ps)*(pr if rain else 1-pr)*(pw if water else 1-pw)
                    joint.append(probability)
                    if water:
                        wet += probability
                        if rain:
                            rain_wet += probability
    return {"joint": joint, "normalization": sum(joint), "wet_probability": wet,
            "rain_given_wet": rain_wet/wet}


FUNCTIONS = {"beta_posterior": beta_posterior, "ols_ridge": ols_ridge, "pca2d": pca2d,
             "mixture_em": mixture_em, "hmm_forward_backward": hmm_forward_backward,
             "sprinkler": sprinkler}


def reference_document() -> dict:
    inputs = {
        "beta_posterior": {"prior": [2, 3], "successes": 7, "failures": 3,
                           "grid": [.1, .25, .5, .75, .9]},
        "ols_ridge": {"x": [[1, 0], [1, 1], [1, 2], [1, 3]], "y": [1, 2, 2, 4], "lambda": .75},
        "pca2d": {"x": [[-2, -1], [-1, -1], [0, 1], [1, 0], [2, 1]]},
        "mixture_em": {"x": [-3, -2.5, -1.5, 1, 2, 3], "means": [-2, 2],
                       "variances": [1, 1.5], "weights": [.4, .6], "iterations": 8, "variance_floor": 1e-8},
        "hmm_forward_backward": {"initial": [.6, .4], "transition": [[.7, .3], [.2, .8]],
                                 "emission": [[.9, .1], [.2, .8]], "observations": [0, 1, 1, 0]},
        "sprinkler": {"cloudy": .5, "sprinkler_given_cloudy": [.5, .1], "rain_given_cloudy": [.2, .8],
                      "wet_given_sprinkler_rain": [[0, .9], [.9, .99]]},
    }
    return {"schema_version": 1, "kind": "cross-engine analytic fixtures", "not_original_demos": True,
            "status": "reference_only", "success": None, "reference_engine": "python-stdlib",
            "absolute_tolerance": 1e-9, "relative_tolerance": 1e-8,
            "fixtures": {name: {"inputs": value, "reference": FUNCTIONS[name](value)}
                         for name, value in inputs.items()}}


def compare(reference, actual, absolute=1e-9, relative=1e-8, path="$") -> list[str]:
    """Compare shape/keys and finite numeric leaves; never accept NaN or booleans."""
    failures = []
    if isinstance(reference, dict):
        if not isinstance(actual, dict) or set(actual) != set(reference):
            return [f"{path}: object keys/shape differ"]
        for key in reference:
            failures.extend(compare(reference[key], actual[key], absolute, relative, f"{path}.{key}"))
    elif isinstance(reference, list):
        if not isinstance(actual, list) or len(actual) != len(reference):
            return [f"{path}: array length/shape differs"]
        for i, (a, b) in enumerate(zip(reference, actual)):
            failures.extend(compare(a, b, absolute, relative, f"{path}[{i}]"))
    elif type(actual) not in (int, float) or not math.isfinite(actual) or not math.isclose(
            reference, actual, abs_tol=absolute, rel_tol=relative):
        failures.append(f"{path}: expected {reference!r}, got {actual!r}")
    return failures
