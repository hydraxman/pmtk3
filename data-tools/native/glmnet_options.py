"""Version-checked, Octave-only additions to authentic legacy public wrappers."""
import hashlib
from pathlib import Path
PINS={"glmnet.m":"84d1ee8cbf9b9e455694709007392f832f2a11240d749e984bd8de42f78c9e6b",
      "glmnetSet.m":"c399d2f5045b0099637c5db6ad82db956cc51d58f5ccc21f540197ac4583b8b7"}

def edits(name,text):
    if name=="glmnetSet.m":
        old="  options.type           = 'covariance';"
        new=old+"""
  if exist('OCTAVE_VERSION','builtin') ~= 0
      options.octave_max_passes = [];
      options.octave_require_complete = false;
  end"""
        assert text.count(old)==1
        text=text.replace(old,new)
        text=text.replace("% LICENSE: GPL-2","""% Octave native 2013-core extension (MATLAB routes/defaults are unchanged):
% options.octave_max_passes: explicit positive integer coordinate-descent
%   pass budget over the WHOLE lambda path. Set 100000 explicitly, for example.
%   [] keeps Gaussian bridge default 100000; logistic keeps numeric maxit.
%   Original 2008 Gaussian had NO maxit cap; old logistic maxit limited
%   per-lambda outer iterations. No fixed translation is scientifically valid.
% options.octave_require_complete: if true, require native jerr=0 AND every
%   requested lambda, otherwise throw PMTK:GlmnetIncompletePath.
% fit.octave_budget records actual max_passes, limit_source, passes_used,
%   requested/completed lambda counts and jerr. Full-path native pass counters
%   may reach limit+1 when the upstream solver detects exhaustion.
%
% LICENSE: GPL-2""")
    else:
        start=text.index("if strcmp(family, 'gaussian')\n    [a0,ca,ia,nin,rsq,alm,nlp,jerr] = glmnetMex")
        end=text.index("\n% Prepare output",start)
        original=text[start:end]
        text=text[:start]+"""octave_native = exist('OCTAVE_VERSION','builtin') ~= 0;
if octave_native
    native_controls = struct('require_complete',false);
    if isfield(options,'octave_max_passes') && ~isempty(options.octave_max_passes)
        native_controls.max_passes = options.octave_max_passes;
    end
    if isfield(options,'octave_require_complete')
        native_controls.require_complete = options.octave_require_complete;
    end
    if strcmp(family,'gaussian')
        [a0,ca,ia,nin,rsq,alm,nlp,jerr,native_budget] = glmnetMex(parm,x,y,jd,vp,ne,nx,nlam,flmin,ulam,thresh,isd,weights,ka,native_controls);
    else
        [a0,ca,ia,nin,dev,alm,nlp,jerr,native_budget] = glmnetMex(parm,x,y,jd,vp,ne,nx,nlam,flmin,ulam,thresh,isd,nc,maxit,kopt,native_controls);
    end
else
"""+original+"\nend\n"+text[end:]
        old="errmsg = err(jerr, maxit, nx);"
        assert text.count(old)==1
        text=text.replace(old,old+"""
if octave_native && jerr < 0 && jerr > -10000
    errmsg.msg = sprintf('GLMnet 2013 incomplete path: lambda %d did not converge within whole-path max_passes=%d; %d/%d solutions returned.', ...
        -jerr,native_budget.max_passes,native_budget.completed_lambda_count,native_budget.requested_lambda_count);
end""")
        marker="%------------------------------------------------------------------\n% End function glmnet"
        assert text.count(marker)==1
        text=text.replace(marker,"if octave_native, fit.octave_budget = native_budget; end\n\n"+marker)
    return text

def prepare_wrappers(repo,work,destination):
    folder=repo/"pmtksupportCopy/packages/glmnet-matlab"
    records=[]
    for name,pin in PINS.items():
        backup=work/"original-wrappers/glmnet"/name
        if not backup.exists():
            data=(folder/name).read_bytes()
            if hashlib.sha256(data).hexdigest()!=pin:raise ValueError(f"Unreviewed legacy wrapper: {name}")
            backup.parent.mkdir(parents=True,exist_ok=True);backup.write_bytes(data)
        data=backup.read_bytes()
        if hashlib.sha256(data).hexdigest()!=pin:raise ValueError("Pristine GLMnet wrapper backup was modified")
        patched=edits(name,data.decode().replace('\r\n','\n')).encode()
        destination.mkdir(parents=True,exist_ok=True)
        target=destination/name;target.write_bytes(patched)
        records.append({"name":name,"original_sha256":pin,"patched_sha256":hashlib.sha256(patched).hexdigest(),
                        "file":str(target),"original_backup":str(backup)})
    return records
