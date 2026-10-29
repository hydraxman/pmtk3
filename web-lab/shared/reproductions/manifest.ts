export const reproductionIds = [
  'arsDemo', 'biclusterDemo', 'binaryFaDemoNewsgroups', 'bolassoDemo',
  'classificationShootout', 'classificationShootoutCvLambdaOnly', 'clusterYeast',
  'codeBreaker', 'convMatMultDemo', 'crf2ChainTrainDemo', 'crfFitStructDemo',
  'deepBelNetClassifyDemo', 'demoRosen2d', 'demoRosenConstrained', 'demoRosenHighDim',
  'discreteDensityModelsShootout', 'dtreeDemoIris', 'emtShootout', 'faBiplotDemo',
  'gpSpatialDemoLaplace', 'groupLassoDemo', 'hmmNbestDemo', 'hopfieldDemo',
  'imageConvDemo', 'imputationGeneMicroarrayDemo', 'imputationMixedAdultDemo',
  'kernelBinaryClassifDemo', 'ldaQdaDemoIris', 'linearKernelDemo', 'linregMlcompDemo',
  'linregSparseEmSynthDemo', 'matconvnetDemo', 'mcAccuracyDemo', 'memoryMapDemo',
  'miDemo', 'minFunc_applications', 'mixGaussOverRelaxedEmDemo', 'multitaskRegDemo',
  'natgradDemo', 'ngramPlot', 'pagerankDemo', 'pagerankDemoMoler', 'pcaYeast',
  'powerCurvesDemo', 'qmrDemo', 'randDgmTimingTest', 'simulatedAnnealingDemo2d',
  'surfer', 'svdImageDemo', 'svmFitTest', 'svmOneVsRestDemo', 'vqDemo',
] as const;
export const hasReproduction = (id: string) => reproductionIds.some(candidate => candidate === id);
