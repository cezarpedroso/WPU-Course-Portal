(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.WPUPlannerCore=api;
})(typeof window==='undefined'?globalThis:window,function(){
  const aliases=Object.freeze({
    'Applied Computer Science - Computer Science':'Computer Science (Applied Computer Science)',
    'Applied Computer Science - Software Engineering':'Software Engineering (Applied Computer Science)',
    'Applied Computer Science- Information Technology':'Information Technology (Applied Computer Science)',
    'Accounting- General':'Accounting',
    'Accounting- Public':'Accounting',
    'Engineering - Civil':'Engineering 3+2 (ISU) – Civil',
    'Engineering - Industrial':'Engineering 3+2 (ISU) – Industrial',
    'Engineering - Mechanical':'Engineering 3+2 (ISU) – Mechanical',
    'Industrial Technology-Industrial Management':'Industrial Technology – Management of Technology Emphasis',
    'Mathematics-Applied':'Applied Mathematics',
    'Mathematics-General':'General Mathematics'
  });
  const levelNames={1:'Freshman',2:'Sophomore',3:'Junior',4:'Senior',5:'Graduate'};
  const seasons={FA:'Fall',SP:'Spring',SU:'Summer'};

  function normalize(value){return String(value||'').toLowerCase().replace(/\(.*?\)/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
  function nextTerm(term){const season=term.slice(0,2),year=Number(term.slice(2));return season==='FA'?'SP'+(year+1):season==='SP'?'SU'+year:'FA'+year}
  function termOrder(term){return Number(term.slice(2))*3+({SP:0,SU:1,FA:2}[term.slice(0,2)]??-1)}
  function seasonName(term){return seasons[String(term||'').slice(0,2)]||''}
  function catalogLevel(code){const match=String(code||'').match(/\s(\d)\d\d/);return match?(levelNames[match[1]]||'Graduate'):'Unknown'}
  function majorPrograms(degreeMap){return (degreeMap.programs||[]).filter(program=>program.kind==='Major')}
  function programFor(major,degreeMap){const wanted=normalize(aliases[major]||major);return majorPrograms(degreeMap).find(program=>normalize(program.name)===wanted)||null}
  function enrollmentMappingCoverage(enrollment,degreeMap){const labels=Object.keys(enrollment?.majors||{}),mapped=labels.filter(label=>programFor(label,degreeMap));return {total:labels.length,mappedLabels:mapped,unmappedLabels:labels.filter(label=>!mapped.includes(label))}}
  function findProgram(id,degreeMap){return (degreeMap.programs||[]).find(program=>program.id===id)||null}
  function includedPrograms(program,degreeMap){
    const blocks=[],seen=new Set();
    function add(current){if(!current||seen.has(current.id))return;seen.add(current.id);(current.inc||[]).forEach(id=>add(findProgram(id,degreeMap)));blocks.push(current)}
    add(program);return blocks;
  }
  function catalogCourses(catalog){return catalog?.courses||catalog||{}}
  function placementFor(programName,courseCode,degreePlans){return degreePlans?.programs?.[programName]?.courses?.[courseCode]||null}
  function termMatches(terms,term){const target=seasonName(term).toLowerCase();return (Array.isArray(terms)?terms:[terms]).filter(Boolean).some(value=>{const candidate=String(value).toLowerCase();return candidate===target||candidate===String(term).slice(0,2).toLowerCase()||candidate.startsWith(target)})}
  function programCourses(programOrMajor,degreeMap,catalog,degreePlans){
    const root=typeof programOrMajor==='string'?programFor(programOrMajor,degreeMap):programOrMajor;
    if(!root)return[];
    const seen=new Set(),courses=[],details=catalogCourses(catalog);
    for(const block of includedPrograms(root,degreeMap)){
      let previousWasAlternative=false;
      for(const item of block.items||[]){
        if(item.t!=='c'||!item.codes?.length){previousWasAlternative=Boolean(item.or);continue}
        const alternative=previousWasAlternative||Boolean(item.or);
        for(const code of item.codes){
          if(seen.has(code))continue;
          seen.add(code);
          const mapDetail=(degreeMap.courses||{})[code]||{},catalogDetail=details[code]||{};
          courses.push({code,name:catalogDetail.title||mapDetail.title||item.title||code,description:catalogDetail.description||'',offering:catalogDetail.offering||'',sourcePage:catalogDetail.sourcePage||null,credits:catalogDetail.credits||mapDetail.credits||item.cr||'',prereq:mapDetail.prereq||'',courseLevel:catalogLevel(code),requirementType:alternative?'choice':'required',recommended:placementFor(root.name,code,degreePlans),requiredBy:root.name,rate:1,seats:24,features:''});
        }
        previousWasAlternative=Boolean(item.or);
      }
    }
    return courses;
  }
  function mapCourses(major,degreeMap,catalog,degreePlans){return programCourses(major,degreeMap,catalog,degreePlans)}
  function requirementSources(courseCode,degreeMap,catalog){return (degreeMap.programs||[]).filter(program=>program.kind==='Major'||program.kind==='Minor').flatMap(program=>{const match=programCourses(program,degreeMap,catalog).find(item=>item.code===courseCode);return match?[{program:program.name,kind:program.kind,requirementType:match.requirementType}]:[]})}
  function sameTermRecords(enrollment,major,term){const terms=enrollment?.majors?.[major]?.terms||{};return Object.entries(terms).filter(([candidate])=>candidate.slice(0,2)===String(term||'').slice(0,2)).sort((a,b)=>termOrder(a[0])-termOrder(b[0]))}
  function forecast(enrollment,major,term,level){
    const values=sameTermRecords(enrollment,major,term).map(([,entry])=>level?(Number(entry.levels?.[level])||0):Number(entry.headcount)||0).slice(-4);
    if(!values.length)return 0;
    const average=values.reduce((sum,value)=>sum+value,0)/values.length;
    if(values.length===1)return Math.round(average);
    const middle=(values.length-1)/2;let numerator=0,denominator=0;
    values.forEach((value,index)=>{numerator+=(index-middle)*(value-average);denominator+=(index-middle)*(index-middle)});
    return Math.max(0,Math.round(average+(denominator?numerator/denominator:0)));
  }
  function courseDemand(enrollment,degreeMap,degreePlans,courseCode,term,catalog){
    const sources=requirementSources(courseCode,degreeMap,catalog),majorSources=sources.filter(source=>source.kind==='Major'),minorSources=sources.filter(source=>source.kind==='Minor'),sourceByProgram=new Map(majorSources.map(source=>[source.program,source]));
    const contributions=[],unsequencedPrograms=new Set(),seenEnrollmentLabels=new Set();
    for(const enrollmentMajor of Object.keys(enrollment?.majors||{})){
      if(seenEnrollmentLabels.has(enrollmentMajor))continue;
      seenEnrollmentLabels.add(enrollmentMajor);
      const program=programFor(enrollmentMajor,degreeMap),source=program&&sourceByProgram.get(program.name);
      if(!source||source.requirementType!=='required')continue;
      const placement=placementFor(program.name,courseCode,degreePlans);
      if(!placement||!placement.year){unsequencedPrograms.add(program.name);continue}
      if(!termMatches(placement.terms,term))continue;
      contributions.push({enrollmentMajor,program:program.name,students:forecast(enrollment,enrollmentMajor,term,placement.year)});
    }
    return {students:contributions.length?contributions.reduce((sum,item)=>sum+item.students,0):null,contributions,majorPrograms:[...new Set(majorSources.map(source=>source.program))],minorPrograms:[...new Set(minorSources.map(source=>source.program))],unsequencedPrograms:[...unsequencedPrograms],minorDemandAvailable:false};
  }
  function roomFits(room,course,students){const target=Math.min(Math.max(1,Number(course.seats)||1),Number(students)||0),needs=String(course.features||'').toLowerCase().split(',').map(value=>value.trim()).filter(Boolean),haystack=(String(room.room||'')+' '+String(room.building||'')+' '+String(room.features||'')).toLowerCase();return target>0&&room.planningEligible!==false&&Number(room.capacity)>0&&Number(room.capacity)>=target&&needs.every(need=>haystack.includes(need))}
  function fitRoom(rooms,course,students){return (rooms||[]).filter(room=>roomFits(room,course,students)).sort((a,b)=>Number(a.capacity)-Number(b.capacity))[0]||null}
  function classroomDiagnostics(rooms){const all=rooms||[];return {total:all.length,missingCapacity:all.filter(room=>!(Number(room.capacity)>0)).length,restricted:all.filter(room=>room.planningEligible===false).length,availabilityProvided:false}}
  function calculateCourse(enrollment,major,term,rooms,course){const cohort=course.cohort||course.recommended?.year||course.level||course.courseLevel,students=Math.round(forecast(enrollment,major,term,cohort)*(Number(course.rate)||0));return {students,sections:Math.ceil(students/Math.max(1,Number(course.seats)||1)),room:fitRoom(rooms,course,students)}}
  return {aliases,normalize,nextTerm,termOrder,seasonName,catalogLevel,programFor,enrollmentMappingCoverage,includedPrograms,programCourses,mapCourses,placementFor,termMatches,requirementSources,sameTermRecords,forecast,courseDemand,roomFits,fitRoom,classroomDiagnostics,calculateCourse};
});
