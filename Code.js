/*** CONSTANTS & API UTILITIES ***/
const API_KEY = 'b33af4c9-abbb-446b-be93-0630d5d13637';
const COMPANY_ID = 'yyboreackbvpwpdo';
const SCHEDULER_ID = 10041443; // adjust if supporting multiple
const CLOCK_ID = 10041447; // adjust if supporting multiple
const STAFF_SHEET_ID = '1nUTBgUh7fxRXaGL086DLShrOdodSlQRQ86nSTtCtnqw'; // shared sheet for staff + exports

/** Date formatting (Australian dd/mm/yy) **/
function toAustralianDate(dateInput) {
  if (!dateInput) return '';
  var date = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
  if (isNaN(date.getTime())) return '';
  var dd = ('0' + date.getDate()).slice(-2);
  var mm = ('0' + (date.getMonth() + 1)).slice(-2);
  var yy = ('' + date.getFullYear()).slice(-2);
  return dd + '/' + mm + '/' + yy;
}

/*** USER/STAFF DIRECTORY ***/
/**
 * Get users from Connecteam API (excludes Admin staff for rostering)
 * Returns a map of userId -> {name, id, role}
 * Uses caching to minimize API calls
 *
 * NOTE: This function excludes Admin staff for rostering purposes.
 * Use getAllUsers() for reporting/display purposes where Admin names should appear.
 */
var _usersCache = null;
var _usersAllCache = null; // Cache for ALL users including Admin
var _usersCacheTime = null;
var USERS_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

function getUsers() {
  Logger.log('getUsers: Fetching users from Connecteam API (excluding Admin)');

  // Check cache first
  if (_usersCache && _usersCacheTime) {
    var cacheAge = new Date().getTime() - _usersCacheTime;
    if (cacheAge < USERS_CACHE_DURATION) {
      Logger.log('getUsers: Using cached users data (age: ' + Math.round(cacheAge/1000) + ' seconds)');
      return _usersCache;
    } else {
      Logger.log('getUsers: Cache expired, fetching fresh data');
    }
  }

  try {
    // Fetch users from Connecteam API
    var queryParams = 'limit=200&offset=0&order=asc&userStatus=active';
    var url = 'users/v1/users?' + queryParams;
    var apiResponse = connecteamApiRequest_(url, 'get', null);
    var response = apiResponse.data || apiResponse; // Handle new response structure

    if (!response || !Array.isArray(response.users)) {
      Logger.log('getUsers ERROR: Unexpected API response format');
      Logger.log('getUsers ERROR: response keys = ' + (response ? Object.keys(response).join(', ') : 'null'));
      throw new Error('Unexpected API response format from Connecteam Users API');
    }

    var usersArray = response.users;
    Logger.log('getUsers: Retrieved ' + usersArray.length + ' users from Connecteam API');

    var users = {};
    var skippedCount = 0;
    var includedCount = 0;

    usersArray.forEach(function(user) {
      // Extract name (firstName + lastName)
      var firstName = user.firstName || '';
      var lastName = user.lastName || '';
      var fullName = (firstName + ' ' + lastName).trim();

      // Extract ID (userId)
      var userId = user.userId;

      if (!fullName || !userId) {
        Logger.log('getUsers: Skipping user - missing name or ID (userId: ' + userId + ')');
        skippedCount++;
        return;
      }

      // Extract team from custom fields
      var team = 'Other';
      if (user.customFields && Array.isArray(user.customFields)) {
        var teamField = user.customFields.find(function(field) {
          return field.name === 'Team';
        });
        if (teamField && teamField.value && Array.isArray(teamField.value) && teamField.value.length > 0) {
          team = teamField.value[0].value || 'Other';
        }
      }

      // Skip separator entries and admin staff
      if (fullName.indexOf('--') !== -1) {
        Logger.log('getUsers: Skipping separator: ' + fullName);
        skippedCount++;
        return;
      }

      if (team === 'Admin') {
        Logger.log('getUsers: Skipping admin user: ' + fullName + ' (userId: ' + userId + ')');
        skippedCount++;
        return;
      }

      // Map team to role for compatibility
      var role = team;

      Logger.log('getUsers: Including user: ' + fullName + ' (userId: ' + userId + ', team: ' + team + ')');
      includedCount++;

      users[userId.toString()] = {
        name: fullName,
        id: userId.toString(),
        role: role
      };
    });

    Logger.log('getUsers: Summary - Total from API: ' + usersArray.length + ', Included: ' + includedCount + ', Skipped: ' + skippedCount);

    Logger.log('getUsers: Processed ' + Object.keys(users).length + ' active users (excluding admin and separators)');

    // Cache the results
    _usersCache = users;
    _usersCacheTime = new Date().getTime();

    return users;

  } catch (error) {
    Logger.log('getUsers ERROR: Failed to fetch from Connecteam API - ' + error.message);
    Logger.log('getUsers: Attempting Google Sheets fallback...');

    // Fallback to Google Sheets if API fails
    try {
      var sheet = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheets()[0];
      var values = sheet.getDataRange().getValues();
      if (!values.length) return {};
      var header = values[0].map(function(h){return (h || '').toString().trim().toLowerCase();});
      var nameIdx = header.indexOf('name');
      var idIdx = header.indexOf('id');
      if (idIdx < 0) idIdx = header.indexOf('user id');
      var roleIdx = header.indexOf('role');
      if (roleIdx < 0) roleIdx = header.indexOf('team');
      var users = {};
      for (var i = 1; i < values.length; ++i) {
        var name = nameIdx >= 0 ? values[i][nameIdx] : values[i][0];
        var id = idIdx >= 0 ? values[i][idIdx] : values[i][1];
        var role = roleIdx >= 0 ? (values[i][roleIdx] || '').toString().trim() : '';
        var nameStr = (name || '').toString().trim();
        var idStr = (id != null ? id.toString().trim() : '');
        if (!nameStr || nameStr.indexOf('--') !== -1) continue;
        if (!idStr || idStr === '0' || idStr.toLowerCase() === 'id') continue;
        users[idStr] = { name: nameStr, id: idStr, role: role };
      }
      Logger.log('getUsers: Fallback successful - retrieved ' + Object.keys(users).length + ' users from Google Sheets');
      return users;
    } catch (sheetError) {
      Logger.log('getUsers ERROR: Fallback to Google Sheets also failed - ' + sheetError.message);
      return {};
    }
  }
}

/**
 * Get ALL users from Connecteam API including Admin staff
 * Returns a map of userId -> {name, id, role}
 * Uses caching to minimize API calls
 *
 * This function includes ALL users (including Admin) for reporting/display purposes.
 * For rostering, use getUsers() which excludes Admin.
 */
function getAllUsers() {
  Logger.log('getAllUsers: Fetching ALL users from Connecteam API (including Admin)');

  // Check cache first
  if (_usersAllCache && _usersCacheTime) {
    var cacheAge = new Date().getTime() - _usersCacheTime;
    if (cacheAge < USERS_CACHE_DURATION) {
      Logger.log('getAllUsers: Using cached ALL users data (age: ' + Math.round(cacheAge/1000) + ' seconds)');
      return _usersAllCache;
    } else {
      Logger.log('getAllUsers: Cache expired, fetching fresh data');
    }
  }

  try {
    // Fetch users from Connecteam API
    var queryParams = 'limit=200&offset=0&order=asc&userStatus=active';
    var url = 'users/v1/users?' + queryParams;
    var apiResponse = connecteamApiRequest_(url, 'get', null);
    var response = apiResponse.data || apiResponse; // Handle new response structure

    if (!response || !Array.isArray(response.users)) {
      Logger.log('getAllUsers ERROR: Unexpected API response format');
      Logger.log('getAllUsers ERROR: response keys = ' + (response ? Object.keys(response).join(', ') : 'null'));
      throw new Error('Unexpected API response format from Connecteam Users API');
    }

    var usersArray = response.users;
    Logger.log('getAllUsers: Retrieved ' + usersArray.length + ' users from Connecteam API');

    var users = {};
    var skippedCount = 0;
    var includedCount = 0;

    usersArray.forEach(function(user) {
      // Extract name (firstName + lastName)
      var firstName = user.firstName || '';
      var lastName = user.lastName || '';
      var fullName = (firstName + ' ' + lastName).trim();

      // Extract ID (userId)
      var userId = user.userId;

      if (!fullName || !userId) {
        Logger.log('getAllUsers: Skipping user - missing name or ID (userId: ' + userId + ')');
        skippedCount++;
        return;
      }

      // Extract team from custom fields
      var team = 'Other';
      if (user.customFields && Array.isArray(user.customFields)) {
        var teamField = user.customFields.find(function(field) {
          return field.name === 'Team';
        });
        if (teamField && teamField.value && Array.isArray(teamField.value) && teamField.value.length > 0) {
          team = teamField.value[0].value || 'Other';
        }
      }

      // ONLY skip separator entries - INCLUDE Admin users for reporting
      if (fullName.indexOf('--') !== -1) {
        Logger.log('getAllUsers: Skipping separator: ' + fullName);
        skippedCount++;
        return;
      }

      // Map team to role for compatibility
      var role = team;

      Logger.log('getAllUsers: Including user: ' + fullName + ' (userId: ' + userId + ', team: ' + team + ')');
      includedCount++;

      users[userId.toString()] = {
        name: fullName,
        id: userId.toString(),
        role: role
      };
    });

    Logger.log('getAllUsers: Summary - Total from API: ' + usersArray.length + ', Included: ' + includedCount + ' (including Admin), Skipped: ' + skippedCount);

    // Cache the results
    _usersAllCache = users;
    _usersCacheTime = new Date().getTime();

    return users;

  } catch (error) {
    Logger.log('getAllUsers ERROR: Failed to fetch from Connecteam API - ' + error.message);
    Logger.log('getAllUsers: Attempting Google Sheets fallback...');

    // Fallback to Google Sheets if API fails
    try {
      var sheet = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheets()[0];
      var values = sheet.getDataRange().getValues();
      if (!values.length) return {};
      var header = values[0].map(function(h){return (h || '').toString().trim().toLowerCase();});
      var nameIdx = header.indexOf('name');
      var idIdx = header.indexOf('id');
      if (idIdx < 0) idIdx = header.indexOf('user id');
      var roleIdx = header.indexOf('role');
      if (roleIdx < 0) roleIdx = header.indexOf('team');
      var users = {};
      for (var i = 1; i < values.length; ++i) {
        var name = nameIdx >= 0 ? values[i][nameIdx] : values[i][0];
        var id = idIdx >= 0 ? values[i][idIdx] : values[i][1];
        var role = roleIdx >= 0 ? (values[i][roleIdx] || '').toString().trim() : '';
        var nameStr = (name || '').toString().trim();
        var idStr = (id != null ? id.toString().trim() : '');
        if (!nameStr || nameStr.indexOf('--') !== -1) continue;
        if (!idStr || idStr === '0' || idStr.toLowerCase() === 'id') continue;
        users[idStr] = { name: nameStr, id: idStr, role: role };
      }
      Logger.log('getAllUsers: Fallback successful - retrieved ' + Object.keys(users).length + ' users from Google Sheets');
      return users;
    } catch (sheetError) {
      Logger.log('getAllUsers ERROR: Fallback to Google Sheets also failed - ' + sheetError.message);
      return {};
    }
  }
}

/** Universal Connecteam API caller **/
function connecteamApiRequest_(endpoint, method, payload) {
  var url = 'https://api.connecteam.com/' + endpoint;
  Logger.log('API Request: ' + method + ' ' + url + (payload ? ' payload: ' + JSON.stringify(payload) : ''));
  var options = {
    'method': method,
    'headers': { 'X-API-KEY': API_KEY, 'Content-Type': 'application/json' },
    'muteHttpExceptions': true
  };
  if (payload) options.payload = JSON.stringify(payload);
  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  var content = response.getContentText();
  Logger.log('API Response: code=' + code + ', content length=' + content.length + ', content preview: ' + content.substring(0, 500));
  if (code >= 400) {
    Logger.log('API Error: ' + content);
    throw new Error('API Error ' + code + ': ' + content);
  }
  var parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    Logger.log('JSON Parse Error: ' + e.message + ' on content: ' + content);
    throw new Error('Invalid JSON response: ' + e.message);
  }
  // Connecteam API wraps data in 'data' object for scheduler endpoints
  var actualData = parsed.data || parsed;
  Logger.log('API Parsed: raw keys=' + Object.keys(parsed) + ', data keys=' + Object.keys(actualData));
  Logger.log('API Parsed: shifts count=' + (actualData.shifts ? actualData.shifts.length : 'N/A') + ', users count=' + (actualData.users ? actualData.users.length : 'N/A'));

  // Return full response including paging information for proper pagination
  return {
    data: actualData,
    paging: parsed.paging || {}
  };
}

/**
 * Assigns selected shifts to users and publishes them in batch
 * @param {Array} assignments - Array of {shiftId, userId, jobId} objects
 * @returns {Object} - {success: Array, errors: Array} with results for each assignment
 */
function assignShiftsToUsers(assignments) {
  Logger.log('assignShiftsToUsers: Processing ' + assignments.length + ' shift assignments');

  if (!assignments || assignments.length === 0) {
    return {success: [], errors: [{error: 'No assignments provided'}]};
  }

  try {
    // Build the payload array for batch API call
    var payload = assignments.map(function(assignment) {
      return {
        "locationData": {"isReferencedToJob": true},
        "assignedUserIds": [assignment.userId],
        "isEditForAllUsers": false,
        "shiftId": assignment.shiftId,
        "isPublished": true
      };
    });

    Logger.log('assignShiftsToUsers: Payload = ' + JSON.stringify(payload));

    // Make the PUT request to Connecteam API
    var endpoint = 'scheduler/v1/schedulers/' + SCHEDULER_ID + '/shifts?notifyUsers=true';
    var apiResponse = connecteamApiRequest_(endpoint, 'put', payload);
    var response = apiResponse.data || apiResponse; // Handle new response structure

    Logger.log('assignShiftsToUsers: Response = ' + JSON.stringify(response));

    // Process response - Connecteam returns success or throws error
    var results = {
      success: assignments.map(function(a) {
        return {
          shiftId: a.shiftId,
          userId: a.userId,
          message: 'Successfully assigned and published'
        };
      }),
      errors: []
    };

    Logger.log('assignShiftsToUsers: Successfully assigned ' + results.success.length + ' shifts');
    return results;

  } catch (e) {
    Logger.log('assignShiftsToUsers ERROR: ' + e.message);

    // Return all assignments as errors
    var errorResults = {
      success: [],
      errors: assignments.map(function(a) {
        return {
          shiftId: a.shiftId,
          userId: a.userId,
          error: e.message
        };
      })
    };

    return errorResults;
  }
}

/*** JOBS DIRECTORY ***/
// Cache for job lookups to avoid redundant API calls
var jobCache = {};

/*** Get job details by ID (with caching) ***/
function getJobById(jobId) {
  if (!jobId) return null;
  if (jobCache[jobId]) {
    Logger.log('Job cache hit for ID ' + jobId + ': ' + jobCache[jobId].title);
    return jobCache[jobId];
  }
  
  try {
    var endpoint = `jobs/v1/jobs/${jobId}`;
    Logger.log('Fetching job details for ID: ' + jobId);
    var apiResponse = connecteamApiRequest_(endpoint, 'get');
    var data = apiResponse.data || apiResponse; // Handle new response structure
    var job = data.job || null;
    if (job) {
      jobCache[jobId] = job;
      Logger.log('Cached job: ' + job.title + ' (ID: ' + jobId + ')');
    } else {
      Logger.log('No job found for ID: ' + jobId);
      jobCache[jobId] = { title: 'Unknown Job', jobId: jobId };
    }
    return job;
  } catch (e) {
    Logger.log('Error fetching job ' + jobId + ': ' + e.message);
    jobCache[jobId] = { title: 'Error: ' + e.message, jobId: jobId };
    return jobCache[jobId];
  }
}

/*** Bulk load jobs for multiple IDs ***/
function loadJobsForIds(jobIds) {
  if (!jobIds || jobIds.length === 0) return;
  var uncachedIds = jobIds.filter(function(id) { return !jobCache[id]; });
  Logger.log('Loading ' + uncachedIds.length + ' uncached jobs for IDs: ' + uncachedIds.join(', '));
  
  uncachedIds.forEach(function(jobId) {
    getJobById(jobId); // Will cache if not already
  });
}

/*** Get all jobs for scheduler (legacy function) ***/
function getJobs() {
  try {
    var allJobs = [];
    var offset = 0;
    var limit = 200; // Connecteam's max limit
    var pageCount = 0;

    do {
      var endpoint = `jobs/v1/jobs?instanceIds=${SCHEDULER_ID}&limit=${limit}&offset=${offset}&order=asc`;
      var apiResponse = connecteamApiRequest_(endpoint, 'get');
      var data = apiResponse.data || apiResponse; // Handle new response structure
      var jobsArray = data.jobs || [];
      
      Logger.log('getJobs page ' + (pageCount + 1) + ': Retrieved ' + jobsArray.length + ' jobs');
      
      allJobs = allJobs.concat(jobsArray);
      offset += limit;
      pageCount++;

      // Safety check: prevent infinite loops
      if (pageCount >= 25) { // 25 * 200 = 5,000 jobs max
        Logger.log('getJobs: Reached safety limit of 25 pages (5,000 jobs)');
        break;
      }
    } while (allJobs.length === limit);

    var jobs = {};
    allJobs.forEach(function(job) {
      jobs[job.jobId || job.id] = job;
      jobCache[job.jobId || job.id] = job; // Cache them
    });
    
    Logger.log('getJobs FIXED: Loaded ' + Object.keys(jobs).length + ' jobs from scheduler across ' + pageCount + ' page(s)');
    return jobs;
  } catch (e) {
    Logger.log('Error loading jobs: ' + e.message);
    return {};
  }
}

/*** SCHEDULED SHIFTS (SUMMARY & DETAIL) ***/
function getScheduledSummary(dateFrom, dateTo) {
  // Convert dates to Unix seconds for API
  var startUnix = Math.floor(new Date(dateFrom).getTime() / 1000);
  var endUnix = Math.floor(new Date(dateTo).getTime() / 1000);
  
  // FIXED: Use pagination to get ALL shifts
  var allShifts = [];
  var offset = 0;
  var limit = 100;
  var pageCount = 0;

  do {
    var endpoint = `scheduler/v1/schedulers/${SCHEDULER_ID}/shifts?startTime=${startUnix}&endTime=${endUnix}&limit=${limit}&offset=${offset}&order=asc`;
    Logger.log('getScheduledSummary: Fetching page ' + (pageCount + 1) + ' with offset ' + offset);

    var apiResponse = connecteamApiRequest_(endpoint, 'get');
    var shiftsData = apiResponse.data || apiResponse; // Handle new response structure
    var pageShifts = shiftsData.shifts || [];
    
    Logger.log('getScheduledSummary page ' + (pageCount + 1) + ': Retrieved ' + pageShifts.length + ' shifts');
    
    allShifts = allShifts.concat(pageShifts);
    offset += limit;
    pageCount++;

    // Safety check: prevent infinite loops
    if (pageCount >= 100) { // 100 * 100 = 10,000 shifts max
      Logger.log('getScheduledSummary: Reached safety limit of 100 pages (10,000 shifts)');
      break;
    }
  } while (allShifts.length === limit);

  Logger.log('getScheduledSummary FIXED: Retrieved ' + allShifts.length + ' total shifts across ' + pageCount + ' page(s)');

  var users = getUsers();
  
  // Extract unique job IDs for lookup
  var uniqueJobIds = [...new Set(allShifts.filter(s => s.jobId).map(s => s.jobId))];
  if (uniqueJobIds.length > 0) {
    loadJobsForIds(uniqueJobIds);
  }
  
  var summary = {};
  allShifts.forEach(function(shift) {
    var assignedUsers = shift.assignedUserIds || [];

    // Skip if no assigned users
    if (assignedUsers.length === 0) return;

    // FIX: If a shift has assigned users, include it regardless of isOpenShift flag
    // The isOpenShift flag with assigned users means it was open but has been claimed
    
    var userId = assignedUsers[0]; // Take first assigned user
    if (!summary[userId]) summary[userId] = {};
    
    var startDate = new Date(shift.startTime * 1000);
    if (shift.startTime && isNaN(startDate.getTime())) {
      Logger.log('Invalid startTime for shift ' + shift.id + ': ' + shift.startTime);
      return;
    }
    
    var month = startDate.toISOString().slice(0, 7);
    if (!summary[userId][month]) summary[userId][month] = { count: 0, details: [] };
    summary[userId][month].count++;
    
    // Get job name with lookup
    var jobName = 'Unknown';
    if (shift.job && shift.job.title) {
      jobName = shift.job.title;
    } else if (shift.jobId) {
      var job = jobCache[shift.jobId];
      jobName = job ? job.title : 'Unknown Job (' + shift.jobId + ')';
    }
    
    summary[userId][month].details.push({
      date: toAustralianDate(startDate),
      job: jobName,
      start: toAustralianDate(startDate),
      end: toAustralianDate(new Date(shift.endTime * 1000))
    });
  });
  
  // Format result for frontend
  var results = [];
  Object.keys(summary).forEach(function(userId) {
    var user = users[userId];
    Object.keys(summary[userId]).forEach(function(month) {
      results.push({
        user: user ? user.name : userId,
        month: month,
        count: summary[userId][month].count,
        details: summary[userId][month].details
      });
    });
  });
  
  Logger.log('getScheduledSummary FIXED: Processed ' + allShifts.length + ' shifts into summary');
  return results;
}

/*** TIME CLOCK (WORKED HOURS) ***/
function getWorkedSummary(dateFrom, dateTo) {
  var fromDate = new Date(dateFrom);
  var toDate = new Date(dateTo);
  var users = getUsers();
  var summary = {};

  // Chunk into 30-day periods for time-clock API (conservative for potential 45-day limit)
  var chunkSize = 30;
  var current = new Date(fromDate);
  while (current <= toDate) {
    var chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + chunkSize);
    if (chunkEnd > toDate) chunkEnd = toDate;

    var fromYmd = current.toISOString().slice(0, 10);
    var toYmd = chunkEnd.toISOString().slice(0, 10);
    
    // FIXED: Use pagination within each time chunk
    var allActivities = [];
    var offset = 0;
    var limit = 100;
    var pageCount = 0;

    do {
      var endpoint = `time-clock/v1/time-clocks/${CLOCK_ID}/time-activities?startDate=${fromYmd}&endDate=${toYmd}&limit=${limit}&offset=${offset}&order=asc`;
      var apiResponse = connecteamApiRequest_(endpoint, 'get');
      var entriesData = apiResponse.data || apiResponse; // Handle new response structure
      
      // Handle different response structures
      var pageActivities = [];
      if (entriesData.timeActivitiesByUsers) {
        pageActivities = entriesData.timeActivitiesByUsers.flatMap(function(userData) {
          return (userData.shifts || []).map(function(shift) {
            return { ...shift, userId: userData.userId };
          });
        });
      } else if (entriesData.data && entriesData.data.timeActivitiesByUsers) {
        pageActivities = entriesData.data.timeActivitiesByUsers.flatMap(function(userData) {
          return (userData.shifts || []).map(function(shift) {
            return { ...shift, userId: userData.userId };
          });
        });
      }

      Logger.log('Time clock chunk (' + fromYmd + ' to ' + toYmd + ') page ' + (pageCount + 1) + ': ' + pageActivities.length + ' activities');
      
      allActivities = allActivities.concat(pageActivities);
      offset += limit;
      pageCount++;

      // Safety check: prevent infinite loops
      if (pageCount >= 50) { // 50 * 100 = 5,000 activities per chunk max
        Logger.log('Time activities: Reached safety limit of 50 pages per chunk');
        break;
      }
    } while (allActivities.length === limit);

    Logger.log('Time clock chunk (' + fromYmd + ' to ' + toYmd + '): ' + allActivities.length + ' total activities across ' + pageCount + ' page(s)');

    // Parse actual structure: data.timeActivitiesByUsers[].shifts, associating userId with each shift
    var activities = allActivities;
    activities.forEach(function(entry) {
      var userId = entry.userId;
      if (!userId) return; // Skip if no userId
      if (!summary[userId]) summary[userId] = {};
      var startDate = new Date(entry.startTime * 1000); // Convert Unix seconds to ms
      var month = startDate.toISOString().slice(0, 7);
      if (!summary[userId][month]) summary[userId][month] = { hours: 0, details: [] };
      var endDate = new Date(entry.endTime * 1000);
      var hours = ((endDate - startDate) / 3600000) || 0;
      summary[userId][month].hours += hours;
      summary[userId][month].details.push({
        date: toAustralianDate(startDate),
        start: toAustralianDate(startDate),
        end: toAustralianDate(endDate),
        hours: hours.toFixed(2)
      });
    });

    current = new Date(chunkEnd);
    current.setDate(current.getDate() + 1); // Advance to next day
  }

  // Format result for frontend
  var results = [];
  Object.keys(summary).forEach(function(userId) {
    var user = users[userId];
    Object.keys(summary[userId]).forEach(function(month) {
      results.push({
        user: user ? user.name : userId,
        month: month,
        hours: summary[userId][month].hours.toFixed(2),
        details: summary[userId][month].details
      });
    });
  });
  
  Logger.log('getScheduledSummary FIXED: Processed ' + allShifts.length + ' shifts into summary');
  return results;
}

/*** AVAILABILITY ***/
function getUnavailability(dateFrom, dateTo) {
  Logger.log('getUnavailability called: dateFrom=' + dateFrom + ', dateTo=' + dateTo);
  
  // Robust date parsing similar to fetchShifts
  function safeParseDate(input) {
    if (!input) return new Date();
    var parsed = new Date(input);
    if (!isNaN(parsed.getTime())) return parsed;
    
    // Try as Unix timestamp
    var numInput = parseInt(input, 10);
    if (!isNaN(numInput)) {
      if (numInput > 1e10) {
        return new Date(numInput); // milliseconds
      } else {
        return new Date(numInput * 1000); // seconds
      }
    }
    
    Logger.log('getUnavailability: Failed to parse date ' + input + ', using current date');
    return new Date();
  }
  
  var fromDate = safeParseDate(dateFrom);
  var toDate = safeParseDate(dateTo);
  
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    Logger.log('getUnavailability ERROR: Invalid dates after parsing');
    return [];
  }
  
  var startUnix = Math.floor(fromDate.getTime() / 1000);
  var endUnix = Math.floor(toDate.getTime() / 1000);
  
  // Validate Unix timestamps
  if (startUnix < 1 || endUnix < 1 || startUnix >= endUnix) {
    Logger.log('getUnavailability ERROR: Invalid Unix range - start=' + startUnix + ', end=' + endUnix);
    return [];
  }
  
  // CRITICAL FIX: Use pagination to get ALL unavailability records
  var allUnavailabilities = [];
  var offset = 0;
  var limit = 100;
  var pageCount = 0;

  try {
    do {
      var endpoint = `scheduler/v1/schedulers/${SCHEDULER_ID}/unavailabilities?startTime=${startUnix}&endTime=${endUnix}&limit=${limit}&offset=${offset}`;
      Logger.log('getUnavailability API call (page ' + (pageCount + 1) + '): ' + endpoint);

      var apiResponse = connecteamApiRequest_(endpoint, 'get');
      var reply = apiResponse.data || apiResponse; // Handle new response structure
      var unavailabilities = reply.unavailabilities || [];

      Logger.log('getUnavailability page ' + (pageCount + 1) + ': Retrieved ' + unavailabilities.length + ' records (offset=' + offset + ')');

      allUnavailabilities = allUnavailabilities.concat(unavailabilities);
      offset += limit;
      pageCount++;

      // Safety check: stop after 10 pages (1000 records) to prevent infinite loops
      if (pageCount >= 10) {
        Logger.log('getUnavailability: Reached safety limit of 10 pages (1000 records)');
        break;
      }
    } while (unavailabilities.length === limit);

    Logger.log('getUnavailability COMPLETE: Retrieved ' + allUnavailabilities.length + ' total unavailability records across ' + pageCount + ' page(s)');
    return allUnavailabilities;
  } catch (e) {
    Logger.log('getUnavailability API error: ' + e.message);
    return allUnavailabilities; // Return what we got so far
  }
}

/*** EXPORT TO SHEET ***/
function exportReportToSheet(reportData, tabName) {
  var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  var sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
  sheet.clearContents();
  if (!reportData.length) {
    sheet.appendRow(["No data"]);
    return;
  }
  // Assume reportData[0] contains all fields as keys
  var headers = Object.keys(reportData[0]);
  sheet.appendRow(headers);
  reportData.forEach(function(row) {
    var arr = headers.map(function(key) {
      return typeof row[key] === 'object' ? JSON.stringify(row[key]) : row[key];
    });
    sheet.appendRow(arr);
  });
}

/*** HTML SERVICE ENTRYPOINT ***/
function doGet() {
  return HtmlService.createHtmlOutputFromFile('connecteam-shift-report')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}

/*** ---------------------- NEW: FAIR SCHEDULER BACKEND ---------------------- ***/

function toIso(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

function overlaps(startA, endA, startB, endB) {
  try {
    var a1 = new Date(startA).getTime();
    var a2 = new Date(endA).getTime();
    var b1 = new Date(startB).getTime();
    var b2 = new Date(endB).getTime();
    return Math.max(a1, b1) < Math.min(a2, b2);
  } catch (e) {
    return false;
  }
}

function fetchShifts(dateFrom, dateTo) {
  Logger.log('fetchShifts called: dateFrom=' + dateFrom + ' (type: ' + typeof dateFrom + '), dateTo=' + dateTo + ' (type: ' + typeof dateTo + ')');
  
  // Robust date parsing to handle various input formats and prevent NaN
  function safeParseDate(input) {
    if (!input) {
      Logger.log('fetchShifts: No date input provided, using current date');
      return new Date();
    }
    
    if (input instanceof Date && !isNaN(input.getTime())) {
      return new Date(input);
    }
    
    if (typeof input === 'string') {
      // Handle ISO strings, date strings, timestamps
      var parsed = new Date(input.trim());
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
      
      // Try alternative parsing for common formats
      // Remove timezone suffixes that might cause issues
      var cleanInput = input.replace(/Z$|[+-]\d{4}$/i, '');
      parsed = new Date(cleanInput);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
      
      // Try as Unix timestamp (seconds or milliseconds)
      var numInput = parseInt(input, 10);
      if (!isNaN(numInput)) {
        if (numInput > 1e10) { // Likely milliseconds
          parsed = new Date(numInput);
        } else { // Likely seconds
          parsed = new Date(numInput * 1000);
        }
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }
    
    Logger.log('fetchShifts: Failed to parse date "' + input + '" (type: ' + typeof input + ')');
    return new Date(); // Fallback to now
  }
  
  var fromDate = safeParseDate(dateFrom);
  var toDate = safeParseDate(dateTo);
  
  // Final validation
  if (isNaN(fromDate.getTime())) {
    Logger.log('fetchShifts: fromDate still invalid after parsing, using now');
    fromDate = new Date();
  }
  if (isNaN(toDate.getTime())) {
    Logger.log('fetchShifts: toDate still invalid after parsing, using now');
    toDate = new Date();
  }
  
  // Ensure chronological order
  if (fromDate > toDate) {
    Logger.log('fetchShifts: Swapping dates (from > to)');
    var temp = fromDate;
    fromDate = toDate;
    toDate = temp;
  }
  
  // Limit extreme date ranges to prevent API issues
  var now = new Date();
  var minAllowed = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000); // 2 years ago
  var maxAllowed = new Date(now.getTime() + 2 * 365 * 24 * 60 * 60 * 1000); // 2 years from now
  
  if (fromDate < minAllowed) {
    Logger.log('fetchShifts: fromDate too far in past, limiting to 2 years ago');
    fromDate = minAllowed;
  }
  if (toDate > maxAllowed) {
    Logger.log('fetchShifts: toDate too far in future, limiting to 2 years from now');
    toDate = maxAllowed;
  }
  
  Logger.log('fetchShifts validated range: ' + fromDate.toISOString().slice(0,10) + ' to ' + toDate.toISOString().slice(0,10) + ' (' + Math.round((toDate - fromDate)/(24*60*60*1000)) + ' days)');
  var allShifts = [];

  // Chunk into 30-day periods for scheduler API (conservative for potential limits)
  var chunkSize = 30;
  var current = new Date(fromDate);
  while (current <= toDate) {
    var chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + chunkSize);
    if (chunkEnd > toDate) chunkEnd = toDate;

    var startUnix = Math.floor(current.getTime() / 1000);
    var endUnix = Math.floor(chunkEnd.getTime() / 1000) + 86399; // Add 23:59:59 for full day inclusion
    
    // Critical validation before API call
    if (isNaN(startUnix) || isNaN(endUnix)) {
      Logger.log('fetchShifts ERROR: NaN Unix timestamp generated for chunk ' + current.toDateString() + ' to ' + chunkEnd.toDateString() +
                   ' (current=' + current.getTime() + ', chunkEnd=' + chunkEnd.getTime() + ')');
      // Skip this chunk
      current = new Date(chunkEnd);
      current.setDate(current.getDate() + 1);
      continue;
    }
    
    if (startUnix < 1 || endUnix < 1) {
      Logger.log('fetchShifts ERROR: Unix timestamp < 1 for chunk ' + current.toDateString() + ' to ' + chunkEnd.toDateString() +
                   ' (start=' + startUnix + ', end=' + endUnix + ')');
      // Skip this chunk
      current = new Date(chunkEnd);
      current.setDate(current.getDate() + 1);
      continue;
    }
    
    if (startUnix >= endUnix) {
      Logger.log('fetchShifts ERROR: Invalid time range (start >= end) for chunk ' + current.toDateString() + ' to ' + chunkEnd.toDateString());
      // Skip this chunk
      current = new Date(chunkEnd);
      current.setDate(current.getDate() + 1);
      continue;
    }
    
    Logger.log('fetchShifts chunk from ' + current.toDateString() + ' to ' + chunkEnd.toDateString() + ' (Unix: ' + startUnix + ' to ' + endUnix + ')');
    var offset = 0;
    var limit = 100;
    var chunkShifts = [];
    var totalPages = 0;
    var hasMore = true;

    while (hasMore) {
      var endpoint = `scheduler/v1/schedulers/${SCHEDULER_ID}/shifts?startTime=${startUnix}&endTime=${endUnix}&sort=created_at&order=asc&limit=${limit}&offset=${offset}`;
      Logger.log('Fetching shifts page: offset=' + offset + ', limit=' + limit);
      var response = connecteamApiRequest_(endpoint, 'get');

      // Extract data and paging info from response
      var data = response.data || response; // Fallback for compatibility
      var paging = response.paging || {};
      var pageShifts = data.shifts || [];

      Logger.log('Received ' + pageShifts.length + ' shifts in this page. Paging info: ' + JSON.stringify(paging) + '. Sample first shift: ' + (pageShifts.length > 0 ? JSON.stringify(pageShifts[0], null, 2).substring(0, 200) : 'none'));

      if (pageShifts.length === 0 && Object.keys(data).length > 0) {
        Logger.log('Warning: No shifts found but data present. Full data structure: ' + JSON.stringify(data, null, 2).substring(0, 500));
      }

      chunkShifts = chunkShifts.concat(pageShifts);
      totalPages++;

      if (pageShifts.length > 0) {
        var firstShift = pageShifts[0];
        var startLocal = new Date(firstShift.startTime * 1000).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
        var endLocal = new Date(firstShift.endTime * 1000).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
        // Connecteam uses assignedUserIds array, not userId
        var assignedUsers = firstShift.assignedUserIds || [];
        var userName = assignedUsers.length > 0 ? (getUsers()[assignedUsers[0]] ? getUsers()[assignedUsers[0]].name : assignedUsers[0]) : 'Open';
        Logger.log('Chunk page ' + totalPages + ' offset ' + offset + ': ' + pageShifts.length + ' shifts (first: ID ' + firstShift.id + ', date ' + toAustralianDate(new Date(firstShift.startTime * 1000)) + ', time ' + startLocal + ' to ' + endLocal + ', user ' + userName + ')');
      } else {
        Logger.log('Chunk page ' + totalPages + ' offset ' + offset + ': ' + pageShifts.length + ' shifts (no shifts, ending pagination)');
      }

      // Check for more pages using paging info OR fallback to old logic
      if (paging.hasOwnProperty('hasMore')) {
        hasMore = paging.hasMore === true;
        Logger.log('Pagination: hasMore=' + hasMore + ' (from API paging info)');
      } else if (paging.hasOwnProperty('total')) {
        hasMore = (offset + pageShifts.length) < paging.total;
        Logger.log('Pagination: hasMore=' + hasMore + ' (calculated from total=' + paging.total + ')');
      } else {
        // Fallback: continue if we got a full page
        hasMore = pageShifts.length === limit;
        Logger.log('Pagination: hasMore=' + hasMore + ' (fallback: received full page of ' + limit + ')');
      }

      offset += limit;
    }

    Logger.log('Chunk total: ' + totalPages + ' pages, ' + chunkShifts.length + ' shifts collected');
    allShifts = allShifts.concat(chunkShifts);

    current = new Date(chunkEnd);
    current.setDate(current.getDate() + 1); // Advance to next day
  }

  var numChunks = Math.ceil((toDate - fromDate) / (1000 * 3600 * 24 * chunkSize)) || 1;
  Logger.log('fetchShifts complete: ' + numChunks + ' chunks processed, ' + allShifts.length + ' total shifts retrieved');
  if (allShifts.length > 0) {
    Logger.log('First shift sample: ID=' + allShifts[0].id + ', start=' + new Date(allShifts[0].startTime * 1000).toISOString() +
               ', assignedUsers=' + JSON.stringify(allShifts[0].assignedUserIds || []) + ', jobId=' + allShifts[0].jobId);
  }
  
  // Update summary to use correct field for assigned vs open
  var assignedCount = allShifts.filter(function(s) {
    return s.assignedUserIds && s.assignedUserIds.length > 0 && !s.isOpenShift;
  }).length;
  var openCount = allShifts.filter(function(s) {
    return !s.assignedUserIds || s.assignedUserIds.length === 0 || s.isOpenShift;
  }).length;
  
  Logger.log('Shifts summary: ' + assignedCount + ' assigned, ' + openCount + ' open/unassigned');
  return allShifts;
}

function getUnavailabilityMap(dateFrom, dateTo) {
  Logger.log('getUnavailabilityMap called with from=' + dateFrom + ' (type: ' + typeof dateFrom + '), to=' + dateTo + ' (type: ' + typeof dateTo + ')');
  
  // Robust date parsing similar to fetchShifts
  var fromDate = new Date(dateFrom);
  var toDate = new Date(dateTo);
  
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    Logger.log('getUnavailabilityMap ERROR: Invalid input dates - from=' + dateFrom + ', to=' + dateTo);
    return {};
  }
  
  var fromUnix = Math.floor(fromDate.getTime() / 1000);
  var toUnix = Math.floor(toDate.getTime() / 1000);
  
  if (fromUnix < 1 || toUnix < 1 || fromUnix >= toUnix) {
    Logger.log('getUnavailabilityMap ERROR: Invalid Unix range - fromUnix=' + fromUnix + ', toUnix=' + toUnix);
    return {};
  }
  
  Logger.log('getUnavailabilityMap: Valid range ' + fromDate.toDateString() + ' to ' + toDate.toDateString() + ' (Unix: ' + fromUnix + ' to ' + toUnix + ')');
  
  var fromIso = fromDate.toISOString();
  var toIso = toDate.toISOString();
  var list = getUnavailability(fromIso, toIso);
  Logger.log('getUnavailability returned ' + (list ? list.length : 0) + ' items');
  
  var map = {};
  (list || []).forEach(function(item, index) {
    var uid = item.userId || (item.user && item.user.id);
    if (!uid) {
      Logger.log('getUnavailabilityMap: Skipping item ' + index + ' with no user ID: ' + JSON.stringify(item).substring(0, 200));
      return;
    }

    var userName = (item.user && item.user.name) || 'Unknown';
    Logger.log('getUnavailabilityMap: Processing item ' + index + ' for user ' + userName + ' (ID: ' + uid + ')');
    Logger.log('getUnavailabilityMap: Item data: ' + JSON.stringify(item, null, 2).substring(0, 300));
    
    // Handle Connecteam unavailability format properly
    var startTime, endTime;
    
    if (item.isAllDay) {
      // All-day unavailability - use the date with start/end of day
      var unavailDate = new Date(item.unavailabilityDate + 'T00:00:00');
      if (!isNaN(unavailDate.getTime())) {
        startTime = Math.floor(unavailDate.getTime() / 1000);
        endTime = Math.floor((unavailDate.getTime() + 24 * 60 * 60 * 1000 - 1) / 1000); // End of day
        Logger.log('getUnavailabilityMap: All-day unavailability for user ' + uid + ' on ' + item.unavailabilityDate);
      }
    } else {
      // Specific time unavailability - combine date with start/end times
      if (item.unavailabilityDate && item.startTime && item.endTime) {
        var startDateTime = new Date(item.unavailabilityDate + 'T' + item.startTime);
        var endDateTime = new Date(item.unavailabilityDate + 'T' + item.endTime);
        
        if (!isNaN(startDateTime.getTime()) && !isNaN(endDateTime.getTime())) {
          startTime = Math.floor(startDateTime.getTime() / 1000);
          endTime = Math.floor(endDateTime.getTime() / 1000);
          Logger.log('getUnavailabilityMap: Timed unavailability for user ' + uid + ' from ' + startDateTime.toISOString() + ' to ' + endDateTime.toISOString());
        }
      }
    }
    
    if (!startTime || !endTime || isNaN(startTime) || isNaN(endTime)) {
      Logger.log('getUnavailabilityMap: Could not parse times for item ' + index + ' user ' + uid + ' - startTime=' + startTime + ', endTime=' + endTime);
      return;
    }
    
    if (!map[uid]) {
      map[uid] = [];
    }
    
    map[uid].push({ start: startTime, end: endTime });
    Logger.log('getUnavailabilityMap: Added period for user ' + userName + ' (ID: ' + uid + '): ' + new Date(startTime * 1000).toISOString() + ' to ' + new Date(endTime * 1000).toISOString());
  });

  Logger.log('getUnavailabilityMap complete: Created map for ' + Object.keys(map).length + ' users');
  Object.keys(map).forEach(function(uid) {
    Logger.log('getUnavailabilityMap: User ' + uid + ' has ' + map[uid].length + ' unavailability period(s)');
    map[uid].forEach(function(period) {
      Logger.log('  - Period: ' + new Date(period.start * 1000).toISOString() + ' to ' + new Date(period.end * 1000).toISOString());
    });
  });

  // Debug: Log unavailability data structure for debugging
  Logger.log('getUnavailabilityMap: Full map structure: ' + JSON.stringify(map, null, 2).substring(0, 1000));

  return map;
}

function jobTypeFromName(jobOrName) {
  var name = '';
  if (typeof jobOrName === 'string') {
    name = jobOrName.toLowerCase();
  } else {
    name = ((jobOrName && jobOrName.name) ? jobOrName.name : '').toLowerCase();
  }
  if (name.indexOf('glass') !== -1) return 'Glassy';
  if (name.indexOf('bar') !== -1) return 'Bar Work';
  return 'Other';
}

function roleMatchesType(role, type) {
  if (!role || !type) return false;
  var r = role.toLowerCase();
  var t = type.toLowerCase();
  if (t.indexOf('bar') !== -1) return r.indexOf('bar') !== -1;
  if (t.indexOf('glass') !== -1) return r.indexOf('glass') !== -1;
  return false;
}

function buildLastShiftEndMap(shifts) {
  var lastEnd = {};
  Logger.log('buildLastShiftEndMap: Processing ' + (shifts ? shifts.length : 0) + ' shifts');
  
  (shifts || []).forEach(function(s) {
    // FIX: If a shift has assigned users, include it regardless of isOpenShift flag
    var assignedUsers = s.assignedUserIds || [];
    if (assignedUsers.length === 0 || !s.endTime) return;
    
    // Convert Unix timestamp to milliseconds if needed
    var endTime = s.endTime;
    if (typeof endTime === 'number' && endTime < 1e12) {
      endTime = endTime * 1000; // Convert seconds to milliseconds
    }
    
    assignedUsers.forEach(function(userId) {
      var prev = lastEnd[userId];
      if (!prev || new Date(endTime).getTime() > new Date(prev).getTime()) {
        lastEnd[userId] = endTime;
      }
    });
  });
  
  Logger.log('buildLastShiftEndMap: Generated last shift map for ' + Object.keys(lastEnd).length + ' users');
  return lastEnd;
}

/**
 * Build last shift end map using timesheet API for more accurate data
 * The scheduler API sometimes misses shifts that appear in timesheets
 * FIXED: Uses 45-day chunks (API limit) for reliable data retrieval
 */
function buildLastShiftEndMapFromTimesheets(endDate, daysBack) {
  var lastEnd = {};
  var startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - daysBack);
  
  Logger.log('buildLastShiftEndMapFromTimesheets: FIXED lookup - ' + daysBack + ' days from ' + endDate.toDateString() + ' to ' + startDate.toDateString());
  
  // CRITICAL FIX: Use 45-day chunks (API limit) instead of 60-day
  var chunkSize = 45; // API limit is 45 days for timesheet endpoint
  var current = new Date(startDate);
  var totalEntries = 0;
  var apiCalls = 0;
  
  while (current < endDate) {
    var chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + chunkSize);
    if (chunkEnd > endDate) chunkEnd = endDate;
    
    var fromYmd = current.toISOString().slice(0, 10);
    var toYmd = chunkEnd.toISOString().slice(0, 10);
    
    try {
      // FIXED: Use pagination within each date chunk
      var allUsers = [];
      var offset = 0;
      var limit = 100;
      var pageCount = 0;

      do {
        var endpoint = 'time-clock/v1/time-clocks/' + CLOCK_ID + '/timesheet?startDate=' + fromYmd + '&endDate=' + toYmd + '&limit=' + limit + '&offset=' + offset + '&order=asc';
        var apiResponse = connecteamApiRequest_(endpoint, 'get');
        var timesheetData = apiResponse.data || apiResponse; // Handle new response structure
        apiCalls++;
        
        var usersArray = timesheetData.users || [];
        Logger.log('Timesheet chunk (' + fromYmd + ' to ' + toYmd + ') page ' + (pageCount + 1) + ': ' + usersArray.length + ' users');
        
        allUsers = allUsers.concat(usersArray);
        offset += limit;
        pageCount++;

        // Safety check: prevent infinite loops
        if (pageCount >= 20) { // 20 * 100 = 2,000 users per chunk max
          Logger.log('Timesheet: Reached safety limit of 20 pages per chunk');
          break;
        }
      } while (allUsers.length === limit);

      // Process timesheet data efficiently
      allUsers.forEach(function(userData) {
        var userId = userData.userId;
        if (!userId) return;
        
        var dailyRecords = userData.dailyRecords || [];
        dailyRecords.forEach(function(dailyRecord) {
          var records = dailyRecord.records || [];
          records.forEach(function(record) {
            if (!record.end || !record.end.timestamp) return;
            
            var endTimestamp = record.end.timestamp * 1000; // Convert to milliseconds
            var prev = lastEnd[userId];
            if (!prev || endTimestamp > prev) {
              lastEnd[userId] = endTimestamp;
              totalEntries++;
            }
          });
        });
      });
      
    } catch (e) {
      Logger.log('buildLastShiftEndMapFromTimesheets: Error fetching timesheet for ' + fromYmd + ' to ' + toYmd + ': ' + e.message);
    }
    
    current = new Date(chunkEnd);
    current.setDate(current.getDate() + 1);
  }
  
  Logger.log('buildLastShiftEndMapFromTimesheets: FIXED - Generated last shift map for ' + Object.keys(lastEnd).length + ' users from ' + totalEntries + ' entries using ' + apiCalls + ' API calls (respecting 45-day API limit)');
  return lastEnd;
}

/**
 * OPTIMIZATION: Direct job type mapping from resource IDs
 * Based on timesheet data analysis, we can map resource IDs directly to job types
 * This avoids expensive job lookup API calls during fairness calculations
 */
var RESOURCE_TO_JOB_TYPE_MAP = {
  // Bar Staff jobs
  '78ee4262-e912-8672-3e90-bb3194963909': 'Bar Work',
  '55488c16-aaea-d978-81f8-5f2db81b3158': 'Bar Work', 
  '1a444d5d-4e19-9da7-c6c9-e899d3e58a27': 'Bar Work', // Bar Manager
  
  // Glassy jobs  
  '8671241f-1af7-d57f-c53e-378f6b1505f8': 'Glassy',
  '408e00e0-1967-fd3a-8fa3-b26a93e7346c': 'Glassy',
  
  // Parent job categories (fallback)
  '18d79c97-cbe1-212b-b08f-f214e5042136': 'Bar Work', // Social Sunday parent
  'd8435d75-e0ea-a273-8788-4527d39d2da9': 'Bar Work'  // Events parent
};

/**
 * OPTIMIZED: Get job type from resource ID without API lookup
 */
function getJobTypeFromResourceId(resourceId, subResourceId) {
  // Try subResourceId first (more specific)
  if (subResourceId && RESOURCE_TO_JOB_TYPE_MAP[subResourceId]) {
    return RESOURCE_TO_JOB_TYPE_MAP[subResourceId];
  }
  
  // Fallback to resourceId (parent job)
  if (resourceId && RESOURCE_TO_JOB_TYPE_MAP[resourceId]) {
    return RESOURCE_TO_JOB_TYPE_MAP[resourceId];
  }
  
  // Ultimate fallback
  return 'Other';
}

function getRollingShiftCounts(endDate, monthsBack) {
  monthsBack = monthsBack || 3;
  var end = new Date(endDate);
  var start = new Date(end);
  start.setMonth(start.getMonth() - monthsBack);
  return getRollingShiftCountsRange(start, end);
}

function getRollingShiftCountsRange(startDate, endDate) {
  var shifts = fetchShifts(startDate, endDate);

  // userId -> {
  //   total: number,
  //   byType: { 'Bar Work': n, 'Glassy': n, 'Other': n },
  //   hoursTotal: number,
  //   hoursByType: { 'Bar Work': hrs, 'Glassy': hrs, 'Other': hrs }
  // }
  var counts = {};

  Logger.log('getRollingShiftCountsRange: Processing ' + shifts.length + ' shifts from ' + startDate.toDateString() + ' to ' + endDate.toDateString());
  
  shifts.forEach(function(s) {
    // FIX: If a shift has assigned users, include it regardless of isOpenShift flag
    var assignedUsers = s.assignedUserIds || [];
    if (assignedUsers.length === 0) return;

    // Get job name for type classification
    var jobName = '';
    if (s.job && s.job.title) {
      jobName = s.job.title;
    } else if (s.jobId) {
      var job = jobCache[s.jobId];
      jobName = job ? job.title : '';
    }
    var t = jobTypeFromName(jobName);

    // Compute duration (hours) from Unix seconds
    var st = typeof s.startTime === 'number' ? s.startTime * 1000 : new Date(s.startTime).getTime();
    var et = typeof s.endTime === 'number' ? s.endTime * 1000 : new Date(s.endTime).getTime();
    var durHrs = (!isNaN(st) && !isNaN(et) && et > st) ? (et - st) / 3600000 : 0;

    // Count shifts and hours for all assigned users
    assignedUsers.forEach(function(userId) {
      if (!counts[userId]) counts[userId] = { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
      counts[userId].total += 1;
      counts[userId].byType[t] = (counts[userId].byType[t] || 0) + 1;
      counts[userId].hoursTotal += durHrs;
      counts[userId].hoursByType[t] = (counts[userId].hoursByType[t] || 0) + durHrs;
    });
  });
  
  Logger.log('getRollingShiftCountsRange: Generated counts for ' + Object.keys(counts).length + ' users');
  return counts;
}

/**
 * Rolling worked counts using Time Clock activities as proxy for worked shifts.
 * Returns map: userId -> { total, byType, hoursTotal, hoursByType }
 */
function getRollingWorkedCounts(endDate, monthsBack) {
  monthsBack = monthsBack || 3;
  var end = new Date(endDate);
  var start = new Date(end);
  start.setMonth(start.getMonth() - monthsBack);
  return getRollingWorkedCountsRange(start, end);
}

function getRollingWorkedCountsRange(startDate, endDate) {
  Logger.log('getRollingWorkedCountsRange: FIXED version using timesheet API with 45-day limit');
  
  // CRITICAL FIX: Use 45-day chunks (API limit) instead of 60-day
  var chunkSize = 45; // API limit is 45 days for timesheet endpoint
  var current = new Date(startDate);
  var counts = {};
  var totalEntries = 0;
  var apiCalls = 0;

  while (current <= endDate) {
    var chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + chunkSize);
    if (chunkEnd > endDate) chunkEnd = endDate;

    var fromYmd = current.toISOString().slice(0, 10);
    var toYmd = chunkEnd.toISOString().slice(0, 10);
    
    try {
      // FIXED: Use pagination within each date chunk
      var allUsers = [];
      var offset = 0;
      var limit = 100;
      var pageCount = 0;

      do {
        // Use timesheet API for more complete and structured data
        var endpoint = 'time-clock/v1/time-clocks/' + CLOCK_ID + '/timesheet?startDate=' + fromYmd + '&endDate=' + toYmd + '&limit=' + limit + '&offset=' + offset + '&order=asc';
        var apiResponse = connecteamApiRequest_(endpoint, 'get');
        var timesheetData = apiResponse.data || apiResponse; // Handle new response structure
        apiCalls++;
        
        var usersArray = timesheetData.users || [];
        Logger.log('Rolling counts chunk (' + fromYmd + ' to ' + toYmd + ') page ' + (pageCount + 1) + ': ' + usersArray.length + ' users');
        
        allUsers = allUsers.concat(usersArray);
        offset += limit;
        pageCount++;

        // Safety check: prevent infinite loops
        if (pageCount >= 20) { // 20 * 100 = 2,000 users per chunk max
          Logger.log('Rolling counts: Reached safety limit of 20 pages per chunk');
          break;
        }
      } while (allUsers.length === limit);
      
      // Process timesheet data efficiently
      allUsers.forEach(function(userData) {
        var userId = userData.userId;
        if (!userId) return;
        
        var dailyRecords = userData.dailyRecords || [];
        dailyRecords.forEach(function(dailyRecord) {
          var records = dailyRecord.records || [];
          records.forEach(function(record) {
            if (!record.start || !record.start.timestamp) return;
            
            var startMs = record.start.timestamp * 1000;
            var endMs = record.end ? record.end.timestamp * 1000 : startMs;
            var hrs = ((endMs - startMs) / 3600000) || 0;
            if (hrs < 0) hrs = 0;
            
            // Use direct resource mapping instead of job API lookups
            var jobType = 'Other';
            if (record.resources && record.resources.length > 0) {
              var resource = record.resources[0]; // Take first resource
              jobType = getJobTypeFromResourceId(resource.resourceId, resource.subResourceId);
            }
            
            if (!counts[userId]) {
              counts[userId] = { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
            }
            
            counts[userId].total += 1;
            counts[userId].byType[jobType] = (counts[userId].byType[jobType] || 0) + 1;
            counts[userId].hoursTotal += hrs;
            counts[userId].hoursByType[jobType] = (counts[userId].hoursByType[jobType] || 0) + hrs;
            totalEntries++;
          });
        });
      });
      
    } catch (e) {
      Logger.log('getRollingWorkedCountsRange: timesheet API error for ' + fromYmd + ' to ' + toYmd + ': ' + e.message);
    }

    current = new Date(chunkEnd);
    current.setDate(current.getDate() + 1);
  }

  var expectedApiCalls = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24 * 30)); // 30-day chunks
  Logger.log('getRollingWorkedCountsRange: FIXED with pagination - Processed ' + totalEntries + ' entries into ' + Object.keys(counts).length + ' users using ' + apiCalls + ' API calls (respecting 45-day API limit)');
  return counts;
}

/**
 * Suggest fair assignments for a list of shift slots.
 * slots: [{ id, startTime, endTime, type }] where type in ['Bar Work','Glassy']
 * options: { enforce24hSoft: boolean }
 */
function suggestAssignments(slots, options) {
  options = options || {};
  var enforce24hSoft = (options.enforce24hSoft !== false); // default true: prefer rest, allow if needed
  var excludedUserIds = options.excludedUserIds || []; // default empty array: no exclusions

  if (!slots || !slots.length) return { assignments: [], summary: { info: 'No slots provided' } };

  // Determine overall window
  var minStart = new Date(slots[0].startTime);
  var maxEnd = new Date(slots[0].endTime);
  slots.forEach(function(s) {
    var st = new Date(s.startTime);
    var et = new Date(s.endTime);
    if (st < minStart) minStart = st;
    if (et > maxEnd) maxEnd = et;
  });

  // OPTIMIZATION: Early filtering - identify relevant users FIRST to avoid processing irrelevant data
  var users = getUsers();
  var uniqueShiftTypes = new Set();
  slots.forEach(function(slot) {
    uniqueShiftTypes.add(slot.type);
  });
  
  var relevantUsers = {};
  Object.keys(users).forEach(function(uid) {
    var user = users[uid];
    var userRole = user.role || '';
    
    // Check if user can work any of the shift types
    var canWorkAnyShift = Array.from(uniqueShiftTypes).some(function(shiftType) {
      return roleMatchesType(userRole, shiftType);
    });
    
    if (canWorkAnyShift) {
      relevantUsers[uid] = user;
    }
  });
  
  Logger.log('suggestAssignments: OPTIMIZED - Only processing ' + Object.keys(relevantUsers).length + ' relevant users (out of ' + Object.keys(users).length + ' total) for shift types: ' + Array.from(uniqueShiftTypes).join(', '));

  var unavail = getUnavailabilityMap(minStart, maxEnd);

  // Last shift ends (from the prior 14 days window to now) - only for relevant users
  var lastWindowStart = new Date(minStart);
  lastWindowStart.setDate(lastWindowStart.getDate() - 14);
  var recentShifts = fetchShifts(lastWindowStart, minStart);
  var lastEndMap = buildLastShiftEndMap(recentShifts);

  // Absolute last shift ends using timesheet API for more accurate data - only for relevant users
  var lastAbsEndMap = buildLastShiftEndMapFromTimesheets(minStart, 120);
  
  Logger.log('Absolute last shift map (120-day timesheet window) - relevant users only:');
  Object.keys(relevantUsers).forEach(function(uid) {
    if (lastAbsEndMap[uid]) {
      var user = relevantUsers[uid];
      var lastShiftDate = new Date(lastAbsEndMap[uid]);
      Logger.log('  User ' + user.name + ' (ID: ' + uid + '): last shift = ' + lastShiftDate.toDateString());
    }
  });

  // OPTIMIZED FAIRNESS: Use timesheets for historical data (more accurate) + shifts for future scheduling
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Historical fairness from timesheets (actual worked hours) - 2 months back
  var historicalStart = new Date(minStart);
  historicalStart.setMonth(historicalStart.getMonth() - 2);
  var workedCounts = getRollingWorkedCountsRange(historicalStart, today);
  
  // Future fairness from scheduled shifts - 1 month forward  
  var futureEnd = new Date(minStart);
  futureEnd.setMonth(futureEnd.getMonth() + 1);
  var fairCounts = getRollingShiftCountsRange(today, futureEnd);
  
  Logger.log('suggestAssignments: Using OPTIMIZED fairness - timesheets from ' + historicalStart.toDateString() + ' to ' + today.toDateString() + ', shifts from ' + today.toDateString() + ' to ' + futureEnd.toDateString());

  function combineFairnessMaps(a, b) {
    var out = {};
    var uids = {};
    Object.keys(a || {}).forEach(function(k){ uids[k] = true; });
    Object.keys(b || {}).forEach(function(k){ uids[k] = true; });
    Object.keys(uids).forEach(function(uid){
      var ca = a[uid] || { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
      var cb = b[uid] || { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
      var byType = {};
      Object.keys(ca.byType || {}).forEach(function(t){ byType[t] = (byType[t] || 0) + ca.byType[t]; });
      Object.keys(cb.byType || {}).forEach(function(t){ byType[t] = (byType[t] || 0) + cb.byType[t]; });
      var hoursByType = {};
      Object.keys(ca.hoursByType || {}).forEach(function(t){ hoursByType[t] = (hoursByType[t] || 0) + ca.hoursByType[t]; });
      Object.keys(cb.hoursByType || {}).forEach(function(t){ hoursByType[t] = (hoursByType[t] || 0) + cb.hoursByType[t]; });
      out[uid] = {
        total: (ca.total || 0) + (cb.total || 0),
        byType: byType,
        hoursTotal: (ca.hoursTotal || 0) + (cb.hoursTotal || 0),
        hoursByType: hoursByType
      };
    });
    return out;
  }

  var combinedCounts = combineFairnessMaps(fairCounts, workedCounts);

  // Helper to sort candidates by fairness for a given type
  // This function now uses the CURRENT combinedCounts which gets updated after each assignment
  function fairnessKey(uid, type) {
    var c = combinedCounts[uid] || { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
    var typeCount = (c.byType && c.byType[type]) || 0;
    var hoursType = (c.hoursByType && c.hoursByType[type]) || 0;
    var hoursTotal = c.hoursTotal || 0;
    Logger.log('fairnessKey for user ' + uid + ' (' + (users[uid] ? users[uid].name : 'Unknown') + '): type=' + type + ', typeCount=' + typeCount + ', total=' + c.total + ', hoursType=' + hoursType.toFixed(2) + ', hoursTotal=' + hoursTotal.toFixed(2) + ' (DYNAMIC - includes pending assignments)');
    return { typeCount: typeCount, total: c.total, hoursType: hoursType, hoursTotal: hoursTotal };
  }

  function candidateFilterForSlot(slot) {
    var cand = [];
    Logger.log('candidateFilterForSlot: Filtering candidates for ' + slot.type + ' shift on ' + new Date(slot.startTime).toDateString());

    Object.keys(users).forEach(function(uid) {
      var user = users[uid];
      var userName = user.name || uid;
      var userRole = user.role || 'No Role';

      // Check if user is excluded from rostering
      if (excludedUserIds.indexOf(uid) !== -1) {
        Logger.log('candidateFilterForSlot: Excluding ' + userName + ' (ID: ' + uid + ') - marked as excluded from auto-rostering');
        return;
      }

      // Check role match
      if (!roleMatchesType(userRole, slot.type)) {
        Logger.log('candidateFilterForSlot: Excluding ' + userName + ' (ID: ' + uid + ') - role "' + userRole + '" does not match shift type "' + slot.type + '"');
        return;
      }

      // Check availability
      var periods = unavail[uid] || [];
      if (periods.length > 0) {
        Logger.log('candidateFilterForSlot: Checking availability for ' + userName + ' (ID: ' + uid + ') - has ' + periods.length + ' unavailability period(s)');
        Logger.log('candidateFilterForSlot: Shift time: ' + new Date(slot.startTime).toISOString() + ' to ' + new Date(slot.endTime).toISOString());
      }
      var blocked = periods.some(function(p) {
        Logger.log('candidateFilterForSlot: Checking period: ' + new Date(p.start * 1000).toISOString() + ' to ' + new Date(p.end * 1000).toISOString());
        var overlapping = overlaps(slot.startTime, slot.endTime, p.start * 1000, p.end * 1000);
        if (overlapping) {
          Logger.log('candidateFilterForSlot: OVERLAP DETECTED - ' + userName + ' unavailable during shift time');
        } else {
          Logger.log('candidateFilterForSlot: No overlap for this period');
        }
        return overlapping;
      });

      if (blocked) {
        Logger.log('candidateFilterForSlot: Excluding ' + userName + ' (ID: ' + uid + ') - unavailable during shift time');
        return;
      }

      Logger.log('candidateFilterForSlot: Including ' + userName + ' (ID: ' + uid + ') - role "' + userRole + '" matches "' + slot.type + '" and available');
      cand.push(uid);
    });

    Logger.log('candidateFilterForSlot: Found ' + cand.length + ' candidates for ' + slot.type + ' shift: ' + cand.map(function(uid) { return users[uid] ? users[uid].name : uid; }).join(', '));
    return cand;
  }

  function within24h(uid, slot) {
    var last = lastEndMap[uid];
    if (!last) return false; // no known last shift
    var gapMs = new Date(slot.startTime) - new Date(last);
    return gapMs < 24 * 3600 * 1000; // true if violates 24h rest
  }

  // Sort slots chronologically to build upon lastEnd updates
  slots.sort(function(a, b) { return new Date(a.startTime) - new Date(b.startTime); });

  var assignments = [];

  // Track which users have been assigned to which time slots to prevent overlapping assignments
  var userAssignedShifts = {}; // Map of userId -> array of {startTime, endTime}

  slots.forEach(function(slot, idx) {
    var allCandidates = candidateFilterForSlot(slot);

    // CRITICAL: Filter out candidates who are already assigned to overlapping shifts
    allCandidates = allCandidates.filter(function(uid) {
      var userShifts = userAssignedShifts[uid] || [];
      var hasOverlap = userShifts.some(function(assignedShift) {
        return overlaps(slot.startTime, slot.endTime, assignedShift.startTime, assignedShift.endTime);
      });

      if (hasOverlap) {
        Logger.log('candidateFilterForSlot: Excluding ' + (users[uid] ? users[uid].name : uid) + ' (ID: ' + uid + ') - already assigned to overlapping shift');
      }

      return !hasOverlap;
    });
    var ok = [];
    var soft = [];
    allCandidates.forEach(function(uid) {
      if (within24h(uid, slot)) soft.push(uid); else ok.push(uid);
    });

    function sortByFairness(arr) {
      Logger.log('sortByFairness: Sorting ' + arr.length + ' candidates: ' + arr.map(function(uid) { return users[uid] ? users[uid].name : uid; }).join(', '));
      
      arr.sort(function(a, b) {
        var ak = fairnessKey(a, slot.type);
        var bk = fairnessKey(b, slot.type);
        
        Logger.log('sortByFairness: Comparing ' + (users[a] ? users[a].name : a) + ' vs ' + (users[b] ? users[b].name : b));
        Logger.log('  ' + (users[a] ? users[a].name : a) + ': typeCount=' + ak.typeCount + ', total=' + ak.total + ', hoursType=' + ak.hoursType.toFixed(2) + ', hoursTotal=' + ak.hoursTotal.toFixed(2));
        Logger.log('  ' + (users[b] ? users[b].name : b) + ': typeCount=' + bk.typeCount + ', total=' + bk.total + ', hoursType=' + bk.hoursType.toFixed(2) + ', hoursTotal=' + bk.hoursTotal.toFixed(2));
        
        // Primary fairness by counts
        if (ak.typeCount !== bk.typeCount) {
          Logger.log('  Decision: ' + (users[ak.typeCount < bk.typeCount ? a : b] ? users[ak.typeCount < bk.typeCount ? a : b].name : (ak.typeCount < bk.typeCount ? a : b)) + ' wins on typeCount');
          return ak.typeCount - bk.typeCount;
        }
        if (ak.total !== bk.total) {
          Logger.log('  Decision: ' + (users[ak.total < bk.total ? a : b] ? users[ak.total < bk.total ? a : b].name : (ak.total < bk.total ? a : b)) + ' wins on total');
          return ak.total - bk.total;
        }

        // Prefer older absolute last shift (wider 90d window) - but only use this for HOURS tie-breaking
        var aAbs = lastAbsEndMap[a] ? new Date(lastAbsEndMap[a]).getTime() : 0;
        var bAbs = lastAbsEndMap[b] ? new Date(lastAbsEndMap[b]).getTime() : 0;
        Logger.log('  Absolute last shift: ' + (users[a] ? users[a].name : a) + '=' + (aAbs ? new Date(aAbs).toDateString() : 'none in 90d') + ', ' + (users[b] ? users[b].name : b) + '=' + (bAbs ? new Date(bAbs).toDateString() : 'none in 90d'));
        
        // Only use absolute last shift for hours-based tie-breaking, not count-based
        if (ak.hoursType !== bk.hoursType) {
          Logger.log('  Decision: ' + (users[ak.hoursType < bk.hoursType ? a : b] ? users[ak.hoursType < bk.hoursType ? a : b].name : (ak.hoursType < bk.hoursType ? a : b)) + ' wins on fewer type hours');
          return ak.hoursType - bk.hoursType;
        }
        if (ak.hoursTotal !== bk.hoursTotal) {
          Logger.log('  Decision: ' + (users[ak.hoursTotal < bk.hoursTotal ? a : b] ? users[ak.hoursTotal < bk.hoursTotal ? a : b].name : (ak.hoursTotal < bk.hoursTotal ? a : b)) + ' wins on fewer total hours');
          return ak.hoursTotal - bk.hoursTotal;
        }
        
        // NOW use absolute last shift for final fairness tie-breaking
        if (aAbs !== bAbs) {
          // If one is 0 (none in 90d), consider that older -> prefer that user
          if (aAbs === 0) { Logger.log('  Decision: ' + (users[a] ? users[a].name : a) + ' wins on oldest absolute last shift (none in 90d)'); return -1; }
          if (bAbs === 0) { Logger.log('  Decision: ' + (users[b] ? users[b].name : b) + ' wins on oldest absolute last shift (none in 90d)'); return 1; }
          Logger.log('  Decision: ' + (users[aAbs < bAbs ? a : b] ? users[aAbs < bAbs ? a : b].name : (aAbs < bAbs ? a : b)) + ' wins on older absolute last shift');
          return aAbs - bAbs;
        }

        // Then apply 14d recency preference (no recent shifts wins; else earlier recent shift)
        var aLast = lastEndMap[a] ? new Date(lastEndMap[a]).getTime() : 0;
        var bLast = lastEndMap[b] ? new Date(lastEndMap[b]).getTime() : 0;
        Logger.log('  14d recency: ' +
          (users[a] ? users[a].name : a) + '=' + (aLast ? new Date(aLast).toDateString() : 'none in 14d') + ', ' +
          (users[b] ? users[b].name : b) + '=' + (bLast ? new Date(bLast).toDateString() : 'none in 14d'));
        // If one has no recent shifts and the other does, prioritize the one with no recent shifts
        if (aLast === 0 && bLast > 0) { Logger.log('  Decision: ' + (users[a] ? users[a].name : a) + ' wins (no recent shifts)'); return -1; }
        if (bLast === 0 && aLast > 0) { Logger.log('  Decision: ' + (users[b] ? users[b].name : b) + ' wins (no recent shifts)'); return 1; }
        // If both have recent shifts OR both have no recent shifts, prefer earlier last shift
        if (aLast !== bLast) {
          Logger.log('  Decision: ' + (users[aLast < bLast ? a : b] ? users[aLast < bLast ? a : b].name : (aLast < bLast ? a : b)) + ' wins on earlier recent shift');
          return aLast - bLast;
        }
        // Job preference tie-breaker: prefer users who have claimed/requested this specific shift
        var aHasClaimed = slot.claimRequests && slot.claimRequests.some(function(claim) {
          return claim.userId === a && claim.status === 'claim_requested';
        });
        var bHasClaimed = slot.claimRequests && slot.claimRequests.some(function(claim) {
          return claim.userId === b && claim.status === 'claim_requested';
        });
        Logger.log('  Job preference (claims): ' + (users[a] ? users[a].name : a) + ' claimed=' + aHasClaimed + ', ' + (users[b] ? users[b].name : b) + ' claimed=' + bHasClaimed);
        if (aHasClaimed && !bHasClaimed) {
          Logger.log('  Decision: ' + (users[a] ? users[a].name : a) + ' wins on job preference (claimed shift)');
          return -1;
        }
        if (bHasClaimed && !aHasClaimed) {
          Logger.log('  Decision: ' + (users[b] ? users[b].name : b) + ' wins on job preference (claimed shift)');
          return 1;
        }
        
        // Final tie-breaker: user name (alphabetical, not ID)
        var aName = users[a] ? users[a].name : a;
        var bName = users[b] ? users[b].name : b;
        Logger.log('  Final tie-breaker: ' + aName + ' vs ' + bName + ' (alphabetical)');
        var nameComparison = aName.localeCompare(bName);
        if (nameComparison !== 0) {
          Logger.log('  Decision: ' + (nameComparison < 0 ? aName : bName) + ' wins alphabetically');
          return nameComparison;
        }
        
        // Ultimate fallback: user ID
        Logger.log('  Ultimate fallback: userId comparison');
        return a.localeCompare(b);
      });
      Logger.log('sortByFairness: Final order: ' + arr.map(function(uid) { return users[uid] ? users[uid].name : uid; }).join(', '));
    }

    sortByFairness(ok);
    sortByFairness(soft);

    var chosen = null;
    var violated = false;

    if (ok.length) {
      chosen = ok[0];
    } else if (soft.length && enforce24hSoft) {
      chosen = soft[0];
      violated = true; // 24h rest violated due to necessity
    }

    if (chosen) {
      var fkBefore = fairnessKey(chosen, slot.type);
      var before = fairCounts[chosen] ? fairCounts[chosen].total : 0;

      // Update rolling counts assuming this slot will be added (affects ordering of later slots)
      if (!combinedCounts[chosen]) combinedCounts[chosen] = { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
      combinedCounts[chosen].total += 1;
      combinedCounts[chosen].byType[slot.type] = (combinedCounts[chosen].byType[slot.type] || 0) + 1;
      // hours for this slot
      var slotHrs = (slot.endTime - slot.startTime) / 3600000;
      combinedCounts[chosen].hoursTotal = (combinedCounts[chosen].hoursTotal || 0) + slotHrs;
      combinedCounts[chosen].hoursByType[slot.type] = (combinedCounts[chosen].hoursByType[slot.type] || 0) + slotHrs;

      // Update last shift end for recency tracking
      lastEndMap[chosen] = slot.endTime;

      // Track this assignment to prevent overlapping shift assignments for the same user
      if (!userAssignedShifts[chosen]) {
        userAssignedShifts[chosen] = [];
      }
      userAssignedShifts[chosen].push({
        startTime: slot.startTime,
        endTime: slot.endTime
      });

      // Record assignment
      assignments.push({
        slotId: slot.id != null ? slot.id : (idx + 1),
        startTime: slot.startTime,
        endTime: slot.endTime,
        type: slot.type,
        assignedUserId: chosen,
        assignedUserName: users[chosen] ? users[chosen].name : chosen,
        role: users[chosen] ? users[chosen].role : '',
        violations: violated ? ['rest24h'] : [],
        fairnessBefore: before,
        fairnessAfter: before + 1
      });
    } else {
      assignments.push({
        slotId: slot.id != null ? slot.id : (idx + 1),
        startTime: slot.startTime,
        endTime: slot.endTime,
        type: slot.type,
        assignedUserId: null,
        assignedUserName: '',
        role: '',
        violations: ['unfilled'],
        fairnessBefore: null,
        fairnessAfter: null
      });
    }
  });

  // Build summary per user after allocation
  var perUser = {};
  assignments.forEach(function(a) {
    if (!a.assignedUserId) return;
    if (!perUser[a.assignedUserId]) perUser[a.assignedUserId] = { user: users[a.assignedUserId].name, total: 0, byType: {} };
    perUser[a.assignedUserId].total += 1;
    perUser[a.assignedUserId].byType[a.type] = (perUser[a.assignedUserId].byType[a.type] || 0) + 1;
  });

  return { assignments: assignments, summary: { perUser: perUser } };
}

/**
 * CLAIMS-PRIORITY VERSION: Suggest fair assignments with shift claims as higher priority
 * Same as suggestAssignments but moves claim checking from priority #7 to priority #2
 * Priority order: Role Match → Shift Claims → Fewest shifts (type) → Fewest shifts (total) → etc.
 */
function suggestAssignmentsWithClaimsPriority(slots, options) {
  options = options || {};
  var enforce24hSoft = (options.enforce24hSoft !== false);
  var excludedUserIds = options.excludedUserIds || [];

  if (!slots || !slots.length) return { assignments: [], summary: { info: 'No slots provided' } };

  var minStart = new Date(slots[0].startTime);
  var maxEnd = new Date(slots[0].endTime);
  slots.forEach(function(s) {
    var st = new Date(s.startTime);
    var et = new Date(s.endTime);
    if (st < minStart) minStart = st;
    if (et > maxEnd) maxEnd = et;
  });

  var users = getUsers();
  var uniqueShiftTypes = new Set();
  slots.forEach(function(slot) {
    uniqueShiftTypes.add(slot.type);
  });

  var relevantUsers = {};
  Object.keys(users).forEach(function(uid) {
    var user = users[uid];
    var userRole = user.role || '';
    var canWorkAnyShift = Array.from(uniqueShiftTypes).some(function(shiftType) {
      return roleMatchesType(userRole, shiftType);
    });
    if (canWorkAnyShift) {
      relevantUsers[uid] = user;
    }
  });

  Logger.log('suggestAssignmentsWithClaimsPriority: OPTIMIZED - Processing ' + Object.keys(relevantUsers).length + ' relevant users for shift types: ' + Array.from(uniqueShiftTypes).join(', '));

  var unavail = getUnavailabilityMap(minStart, maxEnd);
  var lastWindowStart = new Date(minStart);
  lastWindowStart.setDate(lastWindowStart.getDate() - 14);
  var recentShifts = fetchShifts(lastWindowStart, minStart);
  var lastEndMap = buildLastShiftEndMap(recentShifts);
  var lastAbsEndMap = buildLastShiftEndMapFromTimesheets(minStart, 120);

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var historicalStart = new Date(minStart);
  historicalStart.setMonth(historicalStart.getMonth() - 2);
  var workedCounts = getRollingWorkedCountsRange(historicalStart, today);
  var futureEnd = new Date(minStart);
  futureEnd.setMonth(futureEnd.getMonth() + 1);
  var fairCounts = getRollingShiftCountsRange(today, futureEnd);

  Logger.log('suggestAssignmentsWithClaimsPriority: Using OPTIMIZED fairness with CLAIMS PRIORITY');

  function combineFairnessMaps(a, b) {
    var out = {};
    var uids = {};
    Object.keys(a || {}).forEach(function(k){ uids[k] = true; });
    Object.keys(b || {}).forEach(function(k){ uids[k] = true; });
    Object.keys(uids).forEach(function(uid){
      var ca = a[uid] || { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
      var cb = b[uid] || { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
      var byType = {};
      Object.keys(ca.byType || {}).forEach(function(t){ byType[t] = (byType[t] || 0) + ca.byType[t]; });
      Object.keys(cb.byType || {}).forEach(function(t){ byType[t] = (byType[t] || 0) + cb.byType[t]; });
      var hoursByType = {};
      Object.keys(ca.hoursByType || {}).forEach(function(t){ hoursByType[t] = (hoursByType[t] || 0) + ca.hoursByType[t]; });
      Object.keys(cb.hoursByType || {}).forEach(function(t){ hoursByType[t] = (hoursByType[t] || 0) + cb.hoursByType[t]; });
      out[uid] = {
        total: (ca.total || 0) + (cb.total || 0),
        byType: byType,
        hoursTotal: (ca.hoursTotal || 0) + (cb.hoursTotal || 0),
        hoursByType: hoursByType
      };
    });
    return out;
  }

  var combinedCounts = combineFairnessMaps(fairCounts, workedCounts);

  function fairnessKey(uid, type) {
    var c = combinedCounts[uid] || { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
    var typeCount = (c.byType && c.byType[type]) || 0;
    var hoursType = (c.hoursByType && c.hoursByType[type]) || 0;
    var hoursTotal = c.hoursTotal || 0;
    Logger.log('fairnessKey (CLAIMS PRIORITY) for user ' + uid + ': type=' + type + ', typeCount=' + typeCount + ', total=' + c.total + ', hoursType=' + hoursType.toFixed(2) + ', hoursTotal=' + hoursTotal.toFixed(2));
    return { typeCount: typeCount, total: c.total, hoursType: hoursType, hoursTotal: hoursTotal };
  }

  function candidateFilterForSlot(slot) {
    var cand = [];
    Logger.log('candidateFilterForSlot (CLAIMS PRIORITY): Filtering for ' + slot.type + ' shift on ' + new Date(slot.startTime).toDateString());

    Object.keys(users).forEach(function(uid) {
      var user = users[uid];
      var userName = user.name || uid;
      var userRole = user.role || 'No Role';

      if (excludedUserIds.indexOf(uid) !== -1) {
        Logger.log('candidateFilterForSlot: Excluding ' + userName + ' - marked as excluded');
        return;
      }

      if (!roleMatchesType(userRole, slot.type)) {
        Logger.log('candidateFilterForSlot: Excluding ' + userName + ' - role mismatch');
        return;
      }

      var periods = unavail[uid] || [];
      var blocked = periods.some(function(p) {
        return overlaps(slot.startTime, slot.endTime, p.start * 1000, p.end * 1000);
      });

      if (blocked) {
        Logger.log('candidateFilterForSlot: Excluding ' + userName + ' - unavailable');
        return;
      }

      Logger.log('candidateFilterForSlot: Including ' + userName);
      cand.push(uid);
    });

    Logger.log('candidateFilterForSlot: Found ' + cand.length + ' candidates');
    return cand;
  }

  function within24h(uid, slot) {
    var last = lastEndMap[uid];
    if (!last) return false;
    var gapMs = new Date(slot.startTime) - new Date(last);
    return gapMs < 24 * 3600 * 1000;
  }

  slots.sort(function(a, b) { return new Date(a.startTime) - new Date(b.startTime); });

  var assignments = [];

  // Track which users have been assigned to which time slots to prevent overlapping assignments
  var userAssignedShifts = {}; // Map of userId -> array of {startTime, endTime}

  slots.forEach(function(slot, idx) {
    var allCandidates = candidateFilterForSlot(slot);

    // CRITICAL: Filter out candidates who are already assigned to overlapping shifts
    allCandidates = allCandidates.filter(function(uid) {
      var userShifts = userAssignedShifts[uid] || [];
      var hasOverlap = userShifts.some(function(assignedShift) {
        return overlaps(slot.startTime, slot.endTime, assignedShift.startTime, assignedShift.endTime);
      });

      if (hasOverlap) {
        Logger.log('candidateFilterForSlot (ClaimsPriority): Excluding ' + (users[uid] ? users[uid].name : uid) + ' (ID: ' + uid + ') - already assigned to overlapping shift');
      }

      return !hasOverlap;
    });

    // NEW CLAIMS LOGIC: If ANY claims exist, ONLY consider claimants
    var claimantIds = [];
    if (slot.claimRequests && Array.isArray(slot.claimRequests)) {
      claimantIds = slot.claimRequests
        .filter(function(claim) {
          return claim.status === 'claim_requested' && claim.userId != null;
        })
        .map(function(claim) { return claim.userId.toString(); });
    }

    var hasAnyClaims = claimantIds.length > 0;
    var candidatesToConsider = allCandidates;

    if (hasAnyClaims) {
      // Filter to ONLY claimants who are also eligible candidates
      candidatesToConsider = allCandidates.filter(function(uid) {
        return claimantIds.indexOf(uid.toString()) !== -1;
      });

      Logger.log('CLAIMS ABSOLUTE PRIORITY: Shift has ' + claimantIds.length + ' claims. Filtered from ' + allCandidates.length + ' candidates to ' + candidatesToConsider.length + ' claimants only.');
      Logger.log('  Claimants: ' + candidatesToConsider.map(function(uid) { return users[uid] ? users[uid].name : uid; }).join(', '));

      if (candidatesToConsider.length === 0) {
        Logger.log('  WARNING: All claimants were filtered out (unavailable or excluded). Falling back to all candidates.');
        candidatesToConsider = allCandidates;
      }
    } else {
      Logger.log('No claims for this shift. Considering all ' + allCandidates.length + ' eligible candidates.');
    }

    var ok = [];
    var soft = [];
    candidatesToConsider.forEach(function(uid) {
      if (within24h(uid, slot)) soft.push(uid); else ok.push(uid);
    });

    function sortByClaimsPriority(arr) {
      Logger.log('sortByClaimsPriority: Sorting ' + arr.length + ' candidates' + (hasAnyClaims ? ' (CLAIMANTS ONLY)' : ' (no claims)'));

      arr.sort(function(a, b) {
        var ak = fairnessKey(a, slot.type);
        var bk = fairnessKey(b, slot.type);

        Logger.log('sortByClaimsPriority: Comparing ' + (users[a] ? users[a].name : a) + ' vs ' + (users[b] ? users[b].name : b));

        // NOTE: Claims filtering already happened - we're only sorting among claimants (if any claims exist)
        // OR sorting among all candidates (if no claims exist)

        // Priority #1: Fewest shifts of this type
        if (ak.typeCount !== bk.typeCount) {
          Logger.log('  Decision: wins on typeCount');
          return ak.typeCount - bk.typeCount;
        }
        if (ak.total !== bk.total) {
          Logger.log('  Decision: wins on total');
          return ak.total - bk.total;
        }

        // Priority #2+: Continue with other fairness metrics
        if (ak.hoursType !== bk.hoursType) {
          Logger.log('  Decision: wins on fewer type hours');
          return ak.hoursType - bk.hoursType;
        }
        if (ak.hoursTotal !== bk.hoursTotal) {
          Logger.log('  Decision: wins on fewer total hours');
          return ak.hoursTotal - bk.hoursTotal;
        }

        var aAbs = lastAbsEndMap[a] ? new Date(lastAbsEndMap[a]).getTime() : 0;
        var bAbs = lastAbsEndMap[b] ? new Date(lastAbsEndMap[b]).getTime() : 0;
        if (aAbs !== bAbs) {
          if (aAbs === 0) { Logger.log('  Decision: wins on no absolute last shift'); return -1; }
          if (bAbs === 0) { return 1; }
          Logger.log('  Decision: wins on older absolute last shift');
          return aAbs - bAbs;
        }

        var aLast = lastEndMap[a] ? new Date(lastEndMap[a]).getTime() : 0;
        var bLast = lastEndMap[b] ? new Date(lastEndMap[b]).getTime() : 0;
        if (aLast === 0 && bLast > 0) { return -1; }
        if (bLast === 0 && aLast > 0) { return 1; }
        if (aLast !== bLast) {
          return aLast - bLast;
        }

        var aName = users[a] ? users[a].name : a;
        var bName = users[b] ? users[b].name : b;
        var nameComparison = aName.localeCompare(bName);
        if (nameComparison !== 0) {
          return nameComparison;
        }

        return a.localeCompare(b);
      });
      Logger.log('sortByClaimsPriority: Final order: ' + arr.map(function(uid) { return users[uid] ? users[uid].name : uid; }).join(', '));
    }

    sortByClaimsPriority(ok);
    sortByClaimsPriority(soft);

    var chosen = null;
    var violated = false;

    if (ok.length) {
      chosen = ok[0];
    } else if (soft.length && enforce24hSoft) {
      chosen = soft[0];
      violated = true;
    }

    if (chosen) {
      var fkBefore = fairnessKey(chosen, slot.type);
      var before = fairCounts[chosen] ? fairCounts[chosen].total : 0;

      // Check if chosen user claimed this shift
      var chosenHasClaimed = hasAnyClaims && claimantIds.indexOf(chosen.toString()) !== -1;

      if (!combinedCounts[chosen]) combinedCounts[chosen] = { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
      combinedCounts[chosen].total += 1;
      combinedCounts[chosen].byType[slot.type] = (combinedCounts[chosen].byType[slot.type] || 0) + 1;
      var slotHrs = (slot.endTime - slot.startTime) / 3600000;
      combinedCounts[chosen].hoursTotal = (combinedCounts[chosen].hoursTotal || 0) + slotHrs;
      combinedCounts[chosen].hoursByType[slot.type] = (combinedCounts[chosen].hoursByType[slot.type] || 0) + slotHrs;

      lastEndMap[chosen] = slot.endTime;

      // Track this assignment to prevent overlapping shift assignments for the same user
      if (!userAssignedShifts[chosen]) {
        userAssignedShifts[chosen] = [];
      }
      userAssignedShifts[chosen].push({
        startTime: slot.startTime,
        endTime: slot.endTime
      });

      assignments.push({
        slotId: slot.id != null ? slot.id : (idx + 1),
        startTime: slot.startTime,
        endTime: slot.endTime,
        type: slot.type,
        assignedUserId: chosen,
        assignedUserName: users[chosen] ? users[chosen].name : chosen,
        role: users[chosen] ? users[chosen].role : '',
        violations: violated ? ['rest24h'] : [],
        fairnessBefore: before,
        fairnessAfter: before + 1,
        wasClaimed: chosenHasClaimed,
        totalClaims: claimantIds.length
      });
    } else {
      assignments.push({
        slotId: slot.id != null ? slot.id : (idx + 1),
        startTime: slot.startTime,
        endTime: slot.endTime,
        type: slot.type,
        assignedUserId: null,
        assignedUserName: '',
        role: '',
        violations: ['unfilled'],
        fairnessBefore: null,
        fairnessAfter: null
      });
    }
  });

  var perUser = {};
  assignments.forEach(function(a) {
    if (!a.assignedUserId) return;
    if (!perUser[a.assignedUserId]) perUser[a.assignedUserId] = { user: users[a.assignedUserId].name, total: 0, byType: {} };
    perUser[a.assignedUserId].total += 1;
    perUser[a.assignedUserId].byType[a.type] = (perUser[a.assignedUserId].byType[a.type] || 0) + 1;
  });

  return { assignments: assignments, summary: { perUser: perUser } };
}

function exportAssignmentsToSheet(assignments, tabName) {
  tabName = tabName || 'Allocations';
  var rows = (assignments || []).map(function(a) {
    return {
      SlotId: a.slotId,
      Start: a.startTime,
      End: a.endTime,
      Type: a.type,
      User: a.assignedUserName,
      UserId: a.assignedUserId,
      Role: a.role,
      Violations: (a.violations || []).join(',')
    };
  });
  exportReportToSheet(rows, tabName);
  return { ok: true, tab: tabName, rows: rows.length };
}

function getUsersWithRoles() {
  var map = getUsers();
  return Object.keys(map).map(function(id) { return map[id]; });
}

/*** ---------------------- DASHBOARD AGGREGATION & RECOMMENDATIONS ---------------------- ***/

function listOpenShifts(dateFrom, dateTo) {
  Logger.log('listOpenShifts called: dateFrom=' + dateFrom + ' (type: ' + typeof dateFrom + '), dateTo=' + dateTo + ' (type: ' + typeof dateTo + ')');
  
  // Parse dates safely
  var fromDate = new Date(dateFrom);
  var toDate = new Date(dateTo);
  
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    Logger.log('listOpenShifts: Cannot parse date range - from=' + dateFrom + ', to=' + dateTo);
    return [];
  }
  
  Logger.log('listOpenShifts: Valid date range, fetching shifts from ' + fromDate.toDateString() + ' to ' + toDate.toDateString());
  
  var shifts = fetchShifts(fromDate, toDate);
  Logger.log('listOpenShifts: Retrieved ' + shifts.length + ' total shifts');
  
   // Filter for truly open shifts: isOpenShift=true AND no "accepted" status AND openSpots > 0 AND future shifts only
  var now = new Date();
  var openShifts = (shifts || []).filter(function(s) {
    // CRITICAL: Only include future shifts for recommendations (past shifts are considered allocated)
    var shiftStartTime = s.startTime * 1000; // Convert Unix seconds to milliseconds
    var shiftDate = new Date(shiftStartTime);
    var isFuture = shiftDate > now;

    if (!isFuture) {
      Logger.log('listOpenShifts: Excluding past shift ID=' + s.id + ' starting ' + shiftDate.toDateString() + ' - already occurred');
      return false;
    }

    // Base condition: must be marked as open shift
    var isOpenShift = s.isOpenShift === true;

    // Check for accepted status in statuses array (if present)
    var hasAcceptedStatus = false;
    if (s.statuses && Array.isArray(s.statuses)) {
      hasAcceptedStatus = s.statuses.some(function(status) {
        return status.status === 'accepted';
      });
    }

    // Check openSpots (if available)
    var openSpots = s.openSpots || 0;

    // The shift is truly open if it's marked as open, has no accepted status, and has available spots
    var isTrulyOpen = isOpenShift && !hasAcceptedStatus && openSpots > 0;

    // Additional check: if assignedUserIds is empty or null, it's open
    var hasNoAssignedUsers = !s.assignedUserIds || s.assignedUserIds.length === 0;

    // Final condition: must be truly open OR have no assigned users
    var finalOpenCondition = isTrulyOpen || (isOpenShift && hasNoAssignedUsers);
    
    if (finalOpenCondition) {
      Logger.log('listOpenShifts: Confirmed open shift ID=' + s.id + 
                ', isOpenShift=' + s.isOpenShift + 
                ', openSpots=' + openSpots + 
                ', hasAcceptedStatus=' + hasAcceptedStatus + 
                ', assignedUserIds=' + JSON.stringify(s.assignedUserIds || []));
    } else {
      if (hasAcceptedStatus) {
        Logger.log('listOpenShifts: Excluding shift ID=' + s.id + ' - has "accepted" status (not available for re-scheduling)');
      } else if (openSpots === 0 && isOpenShift) {
        Logger.log('listOpenShifts: Excluding shift ID=' + s.id + ' - openSpots=0 despite isOpenShift=true');
      } else if (!isOpenShift) {
        Logger.log('listOpenShifts: Excluding shift ID=' + s.id + ' - isOpenShift=false (permanently assigned)');
      } else if (s.assignedUserIds && s.assignedUserIds.length > 0) {
        Logger.log('listOpenShifts: Excluding shift ID=' + s.id + ' - has assigned users despite isOpenShift=true');
      }
    }
    
    return finalOpenCondition;
  });
  
  Logger.log('listOpenShifts: Filtered to ' + openShifts.length + ' truly open shifts from ' + shifts.length + ' total shifts');
  
  
  Logger.log('listOpenShifts: Filtered to ' + openShifts.length + ' open shifts');
  
  // Pre-load job information for open shifts
  var uniqueJobIds = [...new Set(openShifts.filter(s => s.jobId).map(s => s.jobId))];
  if (uniqueJobIds.length > 0) {
    Logger.log('listOpenShifts: Pre-loading job info for ' + uniqueJobIds.length + ' job IDs');
    loadJobsForIds(uniqueJobIds);
  }
  
  return openShifts.map(function(s) {
    // Determine job name with lookup support
    var jobName = 'Unknown Open Shift';
    if (s.job && s.job.title) {
      jobName = s.job.title;
    } else if (s.jobId) {
      var job = jobCache[s.jobId];
      jobName = job ? job.title : 'Open Job (' + s.jobId.substring(0, 8) + '...)';
    } else if (s.title) {
      jobName = s.title;
    }
    
    // Validate timestamps
    if (!s.startTime || !s.endTime || isNaN(s.startTime) || isNaN(s.endTime)) {
      Logger.log('listOpenShifts ERROR: Invalid timestamps for shift ' + s.id + ', start=' + s.startTime + ', end=' + s.endTime);
      return null;
    }
    
    return {
      id: s.id,
      startTime: s.startTime,
      endTime: s.endTime,
      jobId: s.jobId,
      jobName: jobName,
      type: jobTypeFromName(jobName),
      isOpenShift: s.isOpenShift,
      title: s.title || jobName
    };
  }).filter(function(shift) { return shift !== null; });
}

function getRosterDashboard(dateFrom, dateTo) {
  var startTime = new Date().getTime();
  Logger.log('=== getRosterDashboard START ===');
  Logger.log('getRosterDashboard called with dateFrom: ' + dateFrom + ', dateTo: ' + dateTo);
  
  // Normalize inputs
  var fromDate = new Date(dateFrom);
  var toDate = new Date(dateTo);
  var rangeDays = Math.ceil((toDate - fromDate) / (1000 * 3600 * 24));
  Logger.log('Date range: ' + fromDate.toDateString() + ' to ' + toDate.toDateString() + ' (' + rangeDays + ' days)');

  // Load users once at the start - use getAllUsers to include Admin for reporting
  var usersStartTime = new Date().getTime();
  var users = getAllUsers();
  Logger.log('Step 1/4: Loaded ' + Object.keys(users).length + ' users (including Admin for reporting) in ' + (new Date().getTime() - usersStartTime) + 'ms');

  var today = new Date(); // Server time for split
  today.setHours(0, 0, 0, 0);

  // Fetch shifts with progress logging
  Logger.log('Step 2/4: Fetching shifts for ' + rangeDays + ' day range...');
  var shiftsStartTime = new Date().getTime();
  var shifts = fetchShifts(fromDate, toDate);
  Logger.log('Step 2/4: Fetched ' + shifts.length + ' shifts in ' + (new Date().getTime() - shiftsStartTime) + 'ms');
  
  // Bulk load jobs for better performance
  var jobsStartTime = new Date().getTime();
  var uniqueJobIds = [...new Set(shifts.filter(s => s.jobId).map(s => s.jobId))];
  Logger.log('Pre-loading ' + uniqueJobIds.length + ' unique job IDs...');
  if (uniqueJobIds.length > 0) {
    loadJobsForIds(uniqueJobIds);
  }
  Logger.log('Job lookup completed in ' + (new Date().getTime() - jobsStartTime) + 'ms');
  
  Logger.log('Fetched ' + shifts.length + ' shifts from API. Will process assigned vs open using assignedUserIds and isOpenShift');

  var scheduledCountByUserMonth = {}; // key: userId|month -> count
  var scheduledHoursByUserMonth = {}; // key: userId|month -> hours
  var scheduledDetails = []; // all assigned shifts as detail rows
  var openShifts = [];
  (shifts || []).forEach(function(shift){
    if (!shift.startTime || isNaN(shift.startTime)) {
      Logger.log('Skipping shift with invalid startTime: ' + (shift.id || 'unknown'));
      return;
    }
    var startDate = new Date(shift.startTime * 1000); // Convert Unix seconds to ms
    if (isNaN(startDate.getTime())) {
      Logger.log('Invalid startDate for shift: ' + (shift.id || 'unknown'));
      return;
    }
    var month = startDate.toISOString().slice(0,7);
    
    // Extract job name - check if job details are inline or need lookup
    var jobName = 'Unknown';
    var jobId = shift.jobId;
    if (shift.job && shift.job.title) {
      jobName = shift.job.title; // Inline job details
      Logger.log('Using inline job name: ' + jobName + ' for shift ' + shift.id);
    } else if (jobId) {
      // Need to lookup job details
      var job = getJobById(jobId);
      jobName = job ? job.title : 'Unknown Job (' + jobId + ')';
      Logger.log('Looked up job name: ' + jobName + ' (ID: ' + jobId + ') for shift ' + shift.id);
    }
    
    // Calculate shift duration in hours
    var endDate = new Date(shift.endTime * 1000);
    var shiftHours = 0;
    if (!isNaN(endDate.getTime()) && endDate > startDate) {
      shiftHours = (endDate - startDate) / (1000 * 60 * 60); // Convert ms to hours
    }
    
    // Connecteam uses assignedUserIds array - count ALL assigned users for summary, but take first for details
    var assignedUsers = shift.assignedUserIds || [];

    // Check if shift has been accepted (has assigned users AND accepted status)
    var hasAcceptedStatus = false;
    if (shift.statuses && Array.isArray(shift.statuses)) {
      hasAcceptedStatus = shift.statuses.some(function(status) {
        return status.status === 'accepted';
      });
    }

    // FIX: A shift with assigned users should be treated as assigned, EVEN IF marked as isOpenShift
    // The isOpenShift flag with assignedUserIds likely means it was open but has been claimed/assigned
    // Only exclude if it's open with NO assigned users OR if it's truly open with spots available
    var isAssignedShift = assignedUsers.length > 0;

    // Log shifts that have assigned users but were marked as open (previously excluded)
    if (isAssignedShift && shift.isOpenShift === true) {
      Logger.log('FIX APPLIED: Including shift ID=' + shift.id + ' with assigned users despite isOpenShift=true (openSpots=' + (shift.openSpots || 0) + ', hasAcceptedStatus=' + hasAcceptedStatus + ', date=' + toAustralianDate(startDate) + ', users=[' + assignedUsers.join(',') + '])');
    }

    if (isAssignedShift) {
      // Only count FUTURE shifts in the summary table to match Scheduled Details filtering
      var isFutureShift = startDate > today;
      
      if (isFutureShift) {
        // Count this shift and hours for ALL assigned users in the summary table (FUTURE ONLY)
        assignedUsers.forEach(function(uid) {
          var key = uid + '|' + month;
          scheduledCountByUserMonth[key] = (scheduledCountByUserMonth[key] || 0) + 1;
          scheduledHoursByUserMonth[key] = (scheduledHoursByUserMonth[key] || 0) + shiftHours;
          Logger.log('Counting FUTURE shift ID ' + shift.id + ' for user ' + uid + ' in month ' + month + ' (shifts: ' + scheduledCountByUserMonth[key] + ', hours: ' + scheduledHoursByUserMonth[key].toFixed(1) + ')');
        });
      } else {
        Logger.log('Excluding PAST shift ID ' + shift.id + ' from summary counts (date: ' + toAustralianDate(startDate) + ') - only counting future shifts');
      }
      
      // For the details table, create a separate entry for each assigned user
      // BUT only include FUTURE shifts to avoid duplicating worked shifts
      var endDate = new Date(shift.endTime * 1000);
      if (isNaN(endDate.getTime())) endDate = startDate;
      
      var isFutureShift = startDate > today;
      
      if (isFutureShift) {
        assignedUsers.forEach(function(uid) {
          scheduledDetails.push({
            userId: uid,
            user: users[uid] ? users[uid].name : uid,
            month: month,
            date: toAustralianDate(startDate),
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            job: jobName,
            jobId: jobId,
            title: (typeof shift.title === 'string' && shift.title.trim()) ? shift.title : jobName,
            assignedUsers: assignedUsers, // Include all assigned users for reference
            assigned: true,
            shiftId: shift.id
          });
        });
        Logger.log('Added FUTURE scheduled detail for shift ID=' + shift.id + ', users=[' + assignedUsers.join(', ') + '], date=' + toAustralianDate(startDate));
      } else {
        Logger.log('Excluded PAST scheduled detail for shift ID=' + shift.id + ', date=' + toAustralianDate(startDate) + ' - will appear in worked section if clocked');
      }
      
      Logger.log('Processed assigned shift ID=' + shift.id + ', all users=[' + assignedUsers.join(', ') + '], date=' + toAustralianDate(startDate) + ', job=' + jobName + ' - created ' + assignedUsers.length + ' detail entries');
    } else {
      // Apply the same strict filtering as in listOpenShifts for consistency
      var isOpenShift = shift.isOpenShift === true;
      var hasAcceptedStatus = false;
      if (shift.statuses && Array.isArray(shift.statuses)) {
        hasAcceptedStatus = shift.statuses.some(function(status) {
          return status.status === 'accepted';
        });
      }
      var openSpots = shift.openSpots || 0;
      var hasNoAssignedUsers = !assignedUsers || assignedUsers.length === 0;
      
      // The shift is truly open if it's marked as open, has no accepted status, and has available spots
      var isTrulyOpen = isOpenShift && !hasAcceptedStatus && openSpots > 0;
      
      // Final condition: must be truly open OR have no assigned users
      var finalOpenCondition = isTrulyOpen || (isOpenShift && hasNoAssignedUsers);
      
      if (finalOpenCondition) {
        var endDate = new Date(shift.endTime * 1000);
        if (isNaN(endDate.getTime())) endDate = startDate;
        openShifts.push({
          id: shift.id,
          startTime: startDate.toISOString(),
          endTime: endDate.toISOString(),
          jobId: jobId,
          jobName: jobName,
          title: (typeof shift.title === 'string' && shift.title.trim()) ? shift.title : jobName,
          type: jobTypeFromName(jobName),
          isOpenShift: shift.isOpenShift || true,
          openSpots: openSpots,
          statuses: shift.statuses || []
        });
        Logger.log('Processed open shift: ID=' + shift.id + ', date=' + toAustralianDate(startDate) + ', job=' + jobName + ', openSpots=' + openSpots + ', hasAcceptedStatus=' + hasAcceptedStatus);
      } else {
        if (hasAcceptedStatus) {
          Logger.log('getRosterDashboard: Excluding shift ID=' + shift.id + ' from open shifts - has "accepted" status');
        } else if (openSpots === 0 && isOpenShift) {
          Logger.log('getRosterDashboard: Excluding shift ID=' + shift.id + ' from open shifts - openSpots=0 despite isOpenShift=true');
        } else if (!isOpenShift) {
          Logger.log('getRosterDashboard: Excluding shift ID=' + shift.id + ' from open shifts - isOpenShift=false');
        } else if (assignedUsers.length > 0) {
          Logger.log('getRosterDashboard: Excluding shift ID=' + shift.id + ' from open shifts - has assigned users despite isOpenShift=true');
        }
      }
    }
  });
  Logger.log('Processed scheduled: ' + scheduledDetails.length + ' assigned shifts, ' + openShifts.length + ' open shifts. Sample open: ' + JSON.stringify(openShifts.slice(0, 2), null, 2));

  // Worked time entries - Chunk into 30-day periods for time-clock API (historical: fromDate to today)
  Logger.log('Step 3/4: Processing worked time entries...');
  var workedStartTime = new Date().getTime();
  var workedByUserMonth = {}; // key: userId|month -> {hours, list: []}
  var jobIdsToLoad = new Set(); // collect jobId + subJobId from time activities for batch job title lookup
  var timeToDate = new Date(today);
  var chunkSize = 30;
  var current = new Date(fromDate);
  var workedChunkCount = 0;
  if (current < timeToDate) {
    while (current < timeToDate) {
      workedChunkCount++;
      var chunkEnd = new Date(current);
      chunkEnd.setDate(chunkEnd.getDate() + chunkSize);
      if (chunkEnd > timeToDate) chunkEnd = timeToDate;

      var fromYmd = current.toISOString().slice(0, 10);
      var toYmd = chunkEnd.toISOString().slice(0, 10);
      
      // FIXED: Use pagination within each time chunk
      var allActivities = [];
      var offset = 0;
      var limit = 100;
      var pageCount = 0;

      do {
        var entriesEndpoint = `time-clock/v1/time-clocks/${CLOCK_ID}/time-activities?startDate=${fromYmd}&endDate=${toYmd}&limit=${limit}&offset=${offset}&order=asc`;
        var apiResponse = connecteamApiRequest_(entriesEndpoint, 'get');
        var entriesData = apiResponse.data || apiResponse; // Handle new response structure
        Logger.log('Time activities API response keys: ' + Object.keys(entriesData) + ', has timeActivitiesByUsers=' + !!entriesData.timeActivitiesByUsers);

        // Parse actual structure: timeActivitiesByUsers[].shifts, associating userId with each shift
        // The connecteamApiRequest_ already unwraps the outer 'data', so entriesData is the inner data
        var pageActivities = (entriesData.timeActivitiesByUsers) ?
          entriesData.timeActivitiesByUsers.flatMap(function(userData) {
            Logger.log('Processing time userData: userId=' + userData.userId + ', shifts count=' + (userData.shifts ? userData.shifts.length : 0));
            return (userData.shifts || []).map(function(shift) {
              return { ...shift, userId: userData.userId };
            });
          }) : [];
          
        Logger.log('Time activities page ' + (pageCount + 1) + ': ' + pageActivities.length + ' activities');
        
        allActivities = allActivities.concat(pageActivities);
        offset += limit;
        pageCount++;

        // Safety check: prevent infinite loops
        if (pageCount >= 50) { // 50 * 100 = 5,000 activities per chunk max
          Logger.log('Time activities: Reached safety limit of 50 pages per chunk');
          break;
        }
      } while (allActivities.length === limit);

      Logger.log('Total activities extracted: ' + allActivities.length + ' across ' + pageCount + ' page(s)');
      var activities = allActivities;
      activities.forEach(function(entry){
        var uid = entry.userId;
        if (!uid) return;
        var startTimestamp = entry.start ? entry.start.timestamp : null;
        var endTimestamp = entry.end ? entry.end.timestamp : null;
        if (!startTimestamp) {
          Logger.log('Skipping activity with missing start.timestamp for user ' + uid + ', id: ' + (entry.id || 'unknown'));
          return;
        }
        var startTimeMs = startTimestamp * 1000;
        var startDate = new Date(startTimeMs);
        if (isNaN(startDate.getTime())) {
          Logger.log('Skipping activity with invalid start.timestamp: ' + startTimestamp + ' for user ' + uid);
          return;
        }
        var month = startDate.toISOString().slice(0,7);
        var key = uid + '|' + month;
        if (!workedByUserMonth[key]) workedByUserMonth[key] = { hours: 0, list: [] };
        var endTimeMs = endTimestamp ? endTimestamp * 1000 : startTimeMs;
        var endDate = new Date(endTimeMs);
        if (isNaN(endDate.getTime())) endDate = startDate;
        var hrs = ((endDate - startDate) / 3600000) || 0;
        // Capture job identifiers from time activities
        var jobId = entry.jobId || null;
        var subJobId = entry.subJobId || null;
        if (jobId) jobIdsToLoad.add(jobId);
        if (subJobId) jobIdsToLoad.add(subJobId);

        workedByUserMonth[key].hours += hrs;
        workedByUserMonth[key].list.push({
          userId: uid,
          user: users[uid] ? users[uid].name : uid,
          month: month,
          date: toAustralianDate(startDate),
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          hours: hrs.toFixed(2),
          jobId: jobId,
          subJobId: subJobId
        });
      });

      current = new Date(chunkEnd);
      current.setDate(current.getDate() + 1); // Advance to next day
    }
  } else {
    Logger.log('No historical range for time activities (fromDate >= today)');
  }
  var totalChunks = 0;
  while (current <= toDate) {
    var chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + chunkSize);
    if (chunkEnd > toDate) chunkEnd = toDate;

    var fromYmd = current.toISOString().slice(0, 10);
    var toYmd = chunkEnd.toISOString().slice(0, 10);
    
    // FIXED: Use pagination within each time chunk
    var allActivities = [];
    var offset = 0;
    var limit = 100;
    var pageCount = 0;

    do {
      var entriesEndpoint = `time-clock/v1/time-clocks/${CLOCK_ID}/time-activities?startDate=${fromYmd}&endDate=${toYmd}&limit=${limit}&offset=${offset}&order=asc`;
      var apiResponse = connecteamApiRequest_(entriesEndpoint, 'get');
      var entriesData = apiResponse.data || apiResponse; // Handle new response structure
      Logger.log('Future time activities chunk (' + fromYmd + ' to ' + toYmd + '): keys=' + Object.keys(entriesData) + ', has timeActivitiesByUsers=' + !!entriesData.timeActivitiesByUsers);
      
      // Parse actual structure: timeActivitiesByUsers[].shifts (already unwrapped by connecteamApiRequest_)
      var pageActivities = (entriesData.timeActivitiesByUsers) ?
        entriesData.timeActivitiesByUsers.flatMap(function(userData) {
          return (userData.shifts || []).map(function(shift) {
            return { ...shift, userId: userData.userId };
          });
        }) : [];
        
      Logger.log('Future time activities page ' + (pageCount + 1) + ': ' + pageActivities.length + ' activities');
      
      allActivities = allActivities.concat(pageActivities);
      offset += limit;
      pageCount++;

      // Safety check: prevent infinite loops
      if (pageCount >= 50) { // 50 * 100 = 5,000 activities per chunk max
        Logger.log('Future time activities: Reached safety limit of 50 pages per chunk');
        break;
      }
    } while (allActivities.length === limit);

    Logger.log('Chunk ' + totalChunks + ' (' + fromYmd + ' to ' + toYmd + '): ' + allActivities.length + ' total activities across ' + pageCount + ' page(s)');
    var activities = allActivities;
    totalChunks++;
    activities.forEach(function(entry){
      var uid = entry.userId;
      if (!uid) return;
      var startTimestamp = entry.start ? entry.start.timestamp : null;
      var endTimestamp = entry.end ? entry.end.timestamp : null;
      if (!startTimestamp) {
        Logger.log('Skipping activity with missing start.timestamp for user ' + uid + ', id: ' + (entry.id || 'unknown'));
        return;
      }
      var startTimeMs = startTimestamp * 1000;
      var startDate = new Date(startTimeMs);
      if (isNaN(startDate.getTime())) {
        Logger.log('Skipping activity with invalid start.timestamp: ' + startTimestamp + ' for user ' + uid);
        return;
      }
      var month = startDate.toISOString().slice(0,7);
      var key = uid + '|' + month;
      if (!workedByUserMonth[key]) workedByUserMonth[key] = { hours: 0, list: [] };
      var endTimeMs = endTimestamp ? endTimestamp * 1000 : startTimeMs;
      var endDate = new Date(endTimeMs);
      if (isNaN(endDate.getTime())) endDate = startDate;
      var hrs = ((endDate - startDate) / 3600000) || 0;
      // Capture job identifiers from time activities
      var jobId = entry.jobId || null;
      var subJobId = entry.subJobId || null;
      if (jobId) jobIdsToLoad.add(jobId);
      if (subJobId) jobIdsToLoad.add(subJobId);

      workedByUserMonth[key].hours += hrs;
      workedByUserMonth[key].list.push({
        userId: uid,
        user: users[uid] ? users[uid].name : uid,
        month: month,
        date: toAustralianDate(startDate),
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        hours: hrs.toFixed(2),
        jobId: jobId,
        subJobId: subJobId
      });
    });

    current = new Date(chunkEnd);
    current.setDate(current.getDate() + 1); // Advance to next day
  }
  Logger.log('Step 3/4: Completed worked time processing in ' + (new Date().getTime() - workedStartTime) + 'ms - processed ' + (workedChunkCount + totalChunks) + ' total chunks');
  Logger.log('Worked keys: ' + Object.keys(workedByUserMonth).length);
  // Batch resolve job titles for worked details
  if (jobIdsToLoad.size > 0) {
    Logger.log('Resolving ' + jobIdsToLoad.size + ' job IDs for worked details');
    loadJobsForIds(Array.from(jobIdsToLoad));
  }

  // Step 4: Build final summary
  Logger.log('Step 4/4: Building final summary and aggregating data...');
  var summaryStartTime = new Date().getTime();

  // Build summary joining worked + scheduled per user-month
  var seenKeys = {};
  function addKey(uid, month){ seenKeys[uid + '|' + month] = true; }
  Object.keys(workedByUserMonth).forEach(function(k){
    var parts = k.split('|'); addKey(parts[0], parts[1]);
  });
  Object.keys(scheduledCountByUserMonth).forEach(function(k){
    var parts = k.split('|'); addKey(parts[0], parts[1]);
  });

  var summary = [];
  Object.keys(seenKeys).forEach(function(k){
    var parts = k.split('|'); var uid = parts[0]; var month = parts[1];
    var worked = workedByUserMonth[k] ? workedByUserMonth[k].hours : 0;
    var scheduledHours = scheduledHoursByUserMonth[k] || 0;
    var sched = scheduledCountByUserMonth[k] || 0;
    
    // Determine if this month is past or future for proper total calculation
    var monthDate = new Date(month + '-01');
    var isPast = monthDate < today;
    
    summary.push({
      userId: uid,
      user: users[uid] ? users[uid].name : uid,
      role: users[uid] ? users[uid].role : 'Unknown',
      month: month,
      workedHours: Number(worked).toFixed(1),
      scheduledHours: Number(scheduledHours).toFixed(1),
      scheduledCount: sched,
      workedCount: workedByUserMonth[k] ? workedByUserMonth[k].list.length : 0,
      totalShifts: (workedByUserMonth[k] ? workedByUserMonth[k].list.length : 0) + (scheduledCountByUserMonth[k] || 0),
      isPast: isPast
    });
  });

  // Worked details as flat array with job title enrichment
  var workedDetails = [];
  Object.keys(workedByUserMonth).forEach(function(k){
    workedByUserMonth[k].list.forEach(function(row){
      // Resolve job titles from cached jobs (parent then sub-job)
      var titles = [];
      if (row.jobId) {
        var parentJob = jobCache[row.jobId] || getJobById(row.jobId);
        if (parentJob && parentJob.title) titles.push(parentJob.title);
      }
      if (row.subJobId) {
        var subJob = jobCache[row.subJobId] || getJobById(row.subJobId);
        if (subJob && subJob.title) titles.push(subJob.title);
      }
      // Compose final display title
      row.job = titles.length ? titles.join(' - ') : (row.job || 'Unknown Job');
      workedDetails.push(row);
    });
  });

  Logger.log('getRosterDashboard summary: ' + summary.length + ' user-month entries');
  Logger.log('workedDetails: ' + workedDetails.length + ' entries');
  Logger.log('scheduledDetails: ' + scheduledDetails.length + ' entries');
  Logger.log('openShifts: ' + openShifts.length + ' entries');
  Logger.log('=== getRosterDashboard END ===');
  return { summary: summary, workedDetails: workedDetails, scheduledDetails: scheduledDetails, openShifts: openShifts };
}

// PERFORMANCE OPTIMIZATION: Global cache for expensive operations
var _performanceCache = {
  shifts: null,
  shiftsDateRange: null,
  fairnessCounts: null,
  fairnessDateRange: null,
  workedCounts: null,
  workedDateRange: null,
  users: null,
  lastCacheTime: 0
};

// Cache timeout: 5 minutes
var CACHE_TIMEOUT_MS = 5 * 60 * 1000;

function isCacheValid() {
  return (new Date().getTime() - _performanceCache.lastCacheTime) < CACHE_TIMEOUT_MS;
}

function clearPerformanceCache() {
  _performanceCache = {
    shifts: null,
    shiftsDateRange: null,
    fairnessCounts: null,
    fairnessDateRange: null,
    workedCounts: null,
    workedDateRange: null,
    users: null,
    lastCacheTime: 0
  };
}

function recommendForOpenShifts(dateFrom, dateTo, excludedUserIds) {
  var startTime = new Date().getTime();
  excludedUserIds = excludedUserIds || []; // Default to empty array
  Logger.log('=== recommendForOpenShifts START (OPTIMIZED) ===');
  Logger.log('Input - dateFrom=' + dateFrom + ', dateTo=' + dateTo + ', excludedUserIds=' + JSON.stringify(excludedUserIds));
  
  // Comprehensive date validation
  var fromDate, toDate;
  
  try {
    fromDate = new Date(dateFrom);
    toDate = new Date(dateTo);
  } catch (e) {
    Logger.log('recommendForOpenShifts ERROR: Date parsing error - ' + e.message);
    return {
      assignments: [],
      summary: {
        error: 'Date parsing failed: ' + e.message,
        details: 'from: ' + dateFrom + ', to: ' + dateTo
      }
    };
  }
  
  Logger.log('Parsed dates - fromDate=' + fromDate.toISOString() + ' (valid: ' + !isNaN(fromDate.getTime()) + '), toDate=' + toDate.toISOString() + ' (valid: ' + !isNaN(toDate.getTime()) + ')');
  
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    Logger.log('recommendForOpenShifts ERROR: Invalid date range after parsing - fromDate valid=' + !isNaN(fromDate.getTime()) + ', toDate valid=' + !isNaN(toDate.getTime()));
    return {
      assignments: [],
      summary: {
        error: 'Invalid date range provided',
        details: 'fromDate: ' + (isNaN(fromDate.getTime()) ? 'INVALID' : fromDate.toDateString()) +
                ', toDate: ' + (isNaN(toDate.getTime()) ? 'INVALID' : toDate.toDateString())
      }
    };
  }
  
  // Ensure chronological order
  if (fromDate > toDate) {
    Logger.log('recommendForOpenShifts: Swapping inverted date range');
    var temp = fromDate;
    fromDate = toDate;
    toDate = temp;
  }
  
  var rangeDays = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24));
  Logger.log('recommendForOpenShifts: Valid range of ' + rangeDays + ' days (' + fromDate.toDateString() + ' to ' + toDate.toDateString() + ')');
  
  try {
    // OPTIMIZATION 1: Cache users data
    var usersStartTime = new Date().getTime();
    if (!_performanceCache.users || !isCacheValid()) {
      _performanceCache.users = getUsers();
      Logger.log('recommendForOpenShifts: Loaded ' + Object.keys(_performanceCache.users).length + ' users (fresh)');
    } else {
      Logger.log('recommendForOpenShifts: Using cached users (' + Object.keys(_performanceCache.users).length + ')');
    }
    var users = _performanceCache.users;
    Logger.log('Step 1/4: Users loaded in ' + (new Date().getTime() - usersStartTime) + 'ms');
    
    // OPTIMIZATION 2: Cache shift data for the same date range
    var shiftsStartTime = new Date().getTime();
    var shiftsKey = fromDate.toISOString() + '|' + toDate.toISOString();
    if (!_performanceCache.shifts || _performanceCache.shiftsDateRange !== shiftsKey || !isCacheValid()) {
      _performanceCache.shifts = fetchShifts(fromDate, toDate);
      _performanceCache.shiftsDateRange = shiftsKey;
      _performanceCache.lastCacheTime = new Date().getTime();
      Logger.log('recommendForOpenShifts: Fetched ' + _performanceCache.shifts.length + ' shifts (fresh)');
    } else {
      Logger.log('recommendForOpenShifts: Using cached shifts (' + _performanceCache.shifts.length + ')');
    }
    Logger.log('Step 2/4: Shifts loaded in ' + (new Date().getTime() - shiftsStartTime) + 'ms');

    // Filter for open shifts from cached data
    var openShiftsStartTime = new Date().getTime();
    var now = new Date();
    var openShifts = (_performanceCache.shifts || []).filter(function(s) {
      // CRITICAL: Only include future shifts for recommendations
      var shiftStartTime = s.startTime * 1000; // Convert Unix seconds to milliseconds
      var shiftDate = new Date(shiftStartTime);
      var isFuture = shiftDate > now;

      if (!isFuture) {
        Logger.log('recommendForOpenShifts: Excluding past shift ID=' + s.id + ' starting ' + shiftDate.toDateString() + ' - already occurred');
        return false;
      }

      var isOpenShift = s.isOpenShift === true;
      var hasAcceptedStatus = false;
      if (s.statuses && Array.isArray(s.statuses)) {
        hasAcceptedStatus = s.statuses.some(function(status) {
          return status.status === 'accepted';
        });
      }
      var openSpots = s.openSpots || 0;
      var hasNoAssignedUsers = !s.assignedUserIds || s.assignedUserIds.length === 0;
      var isTrulyOpen = isOpenShift && !hasAcceptedStatus && openSpots > 0;
      return isTrulyOpen || (isOpenShift && hasNoAssignedUsers);
    }).map(function(s) {
      var jobName = 'Unknown Open Shift';

      // CRITICAL FIX: Proper job name resolution with caching
      if (s.job && s.job.title) {
        jobName = s.job.title;
      } else if (s.jobId) {
        // Try cache first, then fetch if needed
        var job = jobCache[s.jobId];
        if (!job) {
          job = getJobById(s.jobId); // This will cache the result
        }
        jobName = job ? job.title : 'Open Job (' + s.jobId.substring(0, 8) + '...)';
      } else if (s.title) {
        jobName = s.title;
      }

      Logger.log('recommendForOpenShifts: Open shift ID=' + s.id + ', jobId=' + s.jobId + ', resolved jobName="' + jobName + '", type=' + jobTypeFromName(jobName) + ', has claimRequests=' + !!(s.claimRequests) + ', claimRequests count=' + (s.claimRequests ? s.claimRequests.length : 0));

      return {
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        jobId: s.jobId,
        jobName: jobName,
        type: jobTypeFromName(jobName),
        isOpenShift: s.isOpenShift,
        title: s.title || jobName,
        statuses: s.statuses || [],
        claimRequests: s.claimRequests || [] // CRITICAL: Pass through claimRequests from API
      };
    });
    Logger.log('Step 3/4: Open shifts filtered in ' + (new Date().getTime() - openShiftsStartTime) + 'ms - found ' + openShifts.length + ' open shifts');
    
    if (openShifts.length === 0) {
      Logger.log('recommendForOpenShifts: No open shifts available for recommendation');
      return {
        assignments: [],
        summary: {
          info: 'No open shifts found in the date range ' + fromDate.toDateString() + ' to ' + toDate.toDateString()
        }
      };
    }
    
    // Create assignment slots with validation
    var slots = [];
    var invalidSlots = 0;
    
    openShifts.forEach(function(shift) {
      Logger.log('recommendForOpenShifts: Processing shift ID=' + shift.id + ', startTime=' + shift.startTime + ' (type: ' + typeof shift.startTime + '), endTime=' + shift.endTime + ' (type: ' + typeof shift.endTime + ')');
      
      // Parse timestamps - they come as Unix seconds from listOpenShifts
      var startTime, endTime;
      
      if (typeof shift.startTime === 'string') {
        // ISO string format
        startTime = new Date(shift.startTime).getTime();
        endTime = new Date(shift.endTime).getTime();
      } else if (typeof shift.startTime === 'number') {
        // Unix timestamp - check if seconds or milliseconds
        if (shift.startTime > 1e10) {
          // Already in milliseconds
          startTime = shift.startTime;
          endTime = shift.endTime;
        } else {
          // Unix seconds, convert to milliseconds
          startTime = shift.startTime * 1000;
          endTime = shift.endTime * 1000;
        }
      } else {
        Logger.log('recommendForOpenShifts ERROR: Invalid timestamp type for shift ' + shift.id);
        invalidSlots++;
        return;
      }
      
      if (!startTime || !endTime || isNaN(startTime) || isNaN(endTime) || startTime >= endTime) {
        Logger.log('recommendForOpenShifts ERROR: Invalid parsed timestamps - ID=' + shift.id +
                   ', startTime=' + startTime + ', endTime=' + endTime);
        invalidSlots++;
        return;
      }
      
      Logger.log('recommendForOpenShifts: Valid shift ID=' + shift.id + ', startTime=' + new Date(startTime).toISOString() + ', endTime=' + new Date(endTime).toISOString());

      // CRITICAL FIX: Extract claims from statuses array
      // Connecteam API provides claims in shift.statuses with status='claim_requested'
      // The userId is stored in the 'assignedUserId' field, NOT 'userId'
      var claimRequests = [];

      if (shift.statuses && Array.isArray(shift.statuses)) {
        // Extract from statuses array (Connecteam standard format)
        claimRequests = shift.statuses.filter(function(status) {
          return status.status === 'claim_requested' && status.assignedUserId != null;
        }).map(function(status) {
          return {
            userId: status.assignedUserId,
            status: status.status
          };
        });
        Logger.log('recommendForOpenShifts: Shift ' + shift.id + ' has ' + claimRequests.length + ' claim requests from statuses array (using assignedUserId field)');
      } else if (shift.claimRequests && Array.isArray(shift.claimRequests)) {
        // Fallback to claimRequests if available
        claimRequests = shift.claimRequests.filter(function(claim) {
          return claim.status === 'claim_requested' && (claim.userId != null || claim.assignedUserId != null);
        }).map(function(claim) {
          return {
            userId: claim.userId || claim.assignedUserId,
            status: claim.status
          };
        });
        Logger.log('recommendForOpenShifts: Shift ' + shift.id + ' has ' + claimRequests.length + ' claim requests from claimRequests field');
      }

      slots.push({
        id: shift.id,
        startTime: startTime,
        endTime: endTime,
        type: shift.type || jobTypeFromName(shift.jobName),
        jobId: shift.jobId,
        jobName: shift.jobName,
        title: shift.title,
        claimRequests: claimRequests
      });
    });
    
    if (invalidSlots > 0) {
      Logger.log('recommendForOpenShifts ERROR: Skipped ' + invalidSlots + ' invalid shifts');
    }
    
    Logger.log('recommendForOpenShifts: Created ' + slots.length + ' valid assignment slots');
    
    if (slots.length === 0) {
      return {
        assignments: [],
        summary: {
          error: 'No valid shifts available for assignment after validation',
          details: 'Found ' + openShifts.length + ' open shifts but ' + invalidSlots + ' had invalid timestamps'
        }
      };
    }
    
    // Generate recommendations
    var result = suggestAssignments(slots, { enforce24hSoft: true, excludedUserIds: excludedUserIds });
    Logger.log('recommendForOpenShifts: suggestAssignments returned ' + result.assignments.length + ' assignments');
    
    // PERFORMANCE OPTIMIZATION: Only calculate fairness for users who can actually work these shifts
    var relevantUserIds = new Set();
    var uniqueShiftTypes = new Set();
    
    // Collect unique shift types and relevant users
    slots.forEach(function(slot) {
      uniqueShiftTypes.add(slot.type);
    });
    
    Object.keys(users).forEach(function(uid) {
      var user = users[uid];
      var userRole = user.role || '';
      
      // Check if user can work any of the shift types
      var canWorkAnyShift = Array.from(uniqueShiftTypes).some(function(shiftType) {
        return roleMatchesType(userRole, shiftType);
      });
      
      if (canWorkAnyShift) {
        relevantUserIds.add(uid);
      }
    });
    
    Logger.log('recommendForOpenShifts: OPTIMIZED - Only calculating fairness for ' + relevantUserIds.size + ' relevant users (out of ' + Object.keys(users).length + ' total) for shift types: ' + Array.from(uniqueShiftTypes).join(', '));
    
    // OPTIMIZATION 3: Use same optimized fairness approach as suggestAssignments
    var fairnessStartTime = new Date().getTime();
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Historical fairness from timesheets (actual worked hours) - 2 months back
    var historicalStart = new Date(fromDate);
    historicalStart.setMonth(historicalStart.getMonth() - 2);
    
    // Future fairness from scheduled shifts - 1 month forward  
    var futureEnd = new Date(fromDate);
    futureEnd.setMonth(futureEnd.getMonth() + 1);
    
    var fairnessKey = historicalStart.toISOString() + '|' + today.toISOString() + '|' + futureEnd.toISOString();
    var fairCounts, workedCounts;
    
    if (_performanceCache.fairnessCounts && _performanceCache.fairnessDateRange === fairnessKey && isCacheValid()) {
      Logger.log('recommendForOpenShifts: Using cached optimized fairness counts');
      fairCounts = _performanceCache.fairnessCounts;
      workedCounts = _performanceCache.workedCounts;
    } else {
      Logger.log('recommendForOpenShifts: Computing fresh OPTIMIZED fairness - timesheets from ' + historicalStart.toDateString() + ' to ' + today.toDateString() + ', shifts from ' + today.toDateString() + ' to ' + futureEnd.toDateString());
      workedCounts = getRollingWorkedCountsRange(historicalStart, today);
      fairCounts = getRollingShiftCountsRange(today, futureEnd);
      
      // Cache the results
      _performanceCache.fairnessCounts = fairCounts;
      _performanceCache.workedCounts = workedCounts;
      _performanceCache.fairnessDateRange = fairnessKey;
      _performanceCache.lastCacheTime = new Date().getTime();
    }
    Logger.log('Step 4/4: Fairness calculations completed in ' + (new Date().getTime() - fairnessStartTime) + 'ms');
    
    function combineFairnessMaps(a, b, relevantUsers) {
      var out = {};
      
      // Only process relevant users for performance
      relevantUsers.forEach(function(uid) {
        var ca = a[uid] || { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
        var cb = b[uid] || { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
        var byType = {};
        Object.keys(ca.byType || {}).forEach(function(t){ byType[t] = (byType[t] || 0) + ca.byType[t]; });
        Object.keys(cb.byType || {}).forEach(function(t){ byType[t] = (byType[t] || 0) + cb.byType[t]; });
        var hoursByType = {};
        Object.keys(ca.hoursByType || {}).forEach(function(t){ hoursByType[t] = (hoursByType[t] || 0) + ca.hoursByType[t]; });
        Object.keys(cb.hoursByType || {}).forEach(function(t){ hoursByType[t] = (hoursByType[t] || 0) + cb.hoursByType[t]; });
        out[uid] = { 
          total: (ca.total || 0) + (cb.total || 0),
          byType: byType,
          hoursTotal: (ca.hoursTotal || 0) + (cb.hoursTotal || 0),
          hoursByType: hoursByType
        };
      });
      return out;
    }
    
    var combinedCounts = combineFairnessMaps(fairCounts, workedCounts, relevantUserIds);
    Logger.log('recommendForOpenShifts: OPTIMIZED - Retrieved combined fairness counts for ' + Object.keys(combinedCounts).length + ' relevant users (vs ' + Object.keys(users).length + ' total users)');
    
    // Add rationale to each assignment with DYNAMIC fairness calculation
    // We need to recalculate fairness after each assignment to show accurate metrics
    var dynamicCombinedCounts = combineFairnessMaps(fairCounts, workedCounts, relevantUserIds);
    
    result.assignments.forEach(function(a, index) {
      if (a.assignedUserId) {
        var user = users[a.assignedUserId] || {};
        
        // Use the fairness counts BEFORE this assignment for rationale
        var fairness = dynamicCombinedCounts[a.assignedUserId] || { total: 0, hoursTotal: 0, byType: {}, hoursByType: {} };
        var type = a.type || 'Unknown';
        var typeCount = (fairness.byType && fairness.byType[type]) || 0;
        var totalCount = fairness.total || 0;
        var hoursType = (fairness.hoursByType && fairness.hoursByType[type]) || 0;
        var hoursTotal = fairness.hoursTotal || 0;
        
        var reason = 'Assigned to ' + a.assignedUserName + ' (role: ' + a.role + '). Fairness metrics BEFORE assignment: ' +
                     type + ' shifts=' + typeCount + ', total shifts=' + totalCount + ', ' +
                     type + ' hours=' + hoursType.toFixed(1) + 'h, total hours=' + hoursTotal.toFixed(1) + 'h. ' +
                     'Tie-breakers applied in order: typeCount -> totalCount -> hoursByType -> hoursTotal -> last-shift age (90d) -> 14d recency -> userId; all with availability respected.';
        if (a.violations.length > 0) {
          reason += ' Note: ' + a.violations.join(', ') + ' violation accepted due to necessity.';
        }
        a.rationale = reason;
        
        // Update dynamic counts for next assignment rationale
        if (!dynamicCombinedCounts[a.assignedUserId]) {
          dynamicCombinedCounts[a.assignedUserId] = { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
        }
        dynamicCombinedCounts[a.assignedUserId].total += 1;
        dynamicCombinedCounts[a.assignedUserId].byType[type] = (dynamicCombinedCounts[a.assignedUserId].byType[type] || 0) + 1;
        
        // Calculate hours for this shift
        var slotHrs = (a.endTime - a.startTime) / 3600000;
        dynamicCombinedCounts[a.assignedUserId].hoursTotal += slotHrs;
        dynamicCombinedCounts[a.assignedUserId].hoursByType[type] = (dynamicCombinedCounts[a.assignedUserId].hoursByType[type] || 0) + slotHrs;
        
      } else {
        // Provide detailed reason for unfilled shifts
        var shiftType = a.type || 'Unknown';
        var availableUsers = Object.keys(users).filter(function(uid) {
          var user = users[uid];
          return roleMatchesType(user.role || '', shiftType);
        });
        
        if (availableUsers.length === 0) {
          a.rationale = 'No users with appropriate role (' + shiftType + ') found in staff directory.';
        } else {
          a.rationale = 'No suitable candidates available for this ' + shiftType + ' shift. ' + availableUsers.length + ' users have the right role but may be unavailable or violate 24h rest rule.';
        }
      }
    });
    
    Logger.log('recommendForOpenShifts: Generated ' + result.assignments.length + ' recommendations with rationale added');
    
    return result;
    
  } catch (error) {
    Logger.log('recommendForOpenShifts: Unexpected error - ' + error.message + '\nStack: ' + error.stack);
    return {
      assignments: [],
      summary: {
        error: 'Failed to generate recommendations: ' + error.message,
        details: 'Date range: ' + fromDate.toDateString() + ' to ' + toDate.toDateString()
      }
    };
  } finally {
    Logger.log('=== recommendForOpenShifts END ===');
  }
}

/**
 * CLAIMS-PRIORITY VERSION: Recommend assignments for open shifts with claims as higher priority
 * Uses suggestAssignmentsWithClaimsPriority instead of suggestAssignments
 */
function recommendForOpenShiftsClaimsPriority(dateFrom, dateTo, excludedUserIds) {
  var startTime = new Date().getTime();
  excludedUserIds = excludedUserIds || [];
  Logger.log('=== recommendForOpenShiftsClaimsPriority START (CLAIMS PRIORITY) ===');
  Logger.log('Input - dateFrom=' + dateFrom + ', dateTo=' + dateTo + ', excludedUserIds=' + JSON.stringify(excludedUserIds));

  var fromDate, toDate;

  try {
    fromDate = new Date(dateFrom);
    toDate = new Date(dateTo);
  } catch (e) {
    Logger.log('recommendForOpenShiftsClaimsPriority ERROR: Date parsing error - ' + e.message);
    return {
      assignments: [],
      summary: {
        error: 'Date parsing failed: ' + e.message,
        details: 'from: ' + dateFrom + ', to: ' + dateTo
      }
    };
  }

  Logger.log('Parsed dates - fromDate=' + fromDate.toISOString() + ', toDate=' + toDate.toISOString());

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    Logger.log('recommendForOpenShiftsClaimsPriority ERROR: Invalid date range after parsing');
    return {
      assignments: [],
      summary: {
        error: 'Invalid date range provided',
        details: 'fromDate: ' + (isNaN(fromDate.getTime()) ? 'INVALID' : fromDate.toDateString()) +
                ', toDate: ' + (isNaN(toDate.getTime()) ? 'INVALID' : toDate.toDateString())
      }
    };
  }

  if (fromDate > toDate) {
    Logger.log('recommendForOpenShiftsClaimsPriority: Swapping inverted date range');
    var temp = fromDate;
    fromDate = toDate;
    toDate = temp;
  }

  var rangeDays = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24));
  Logger.log('recommendForOpenShiftsClaimsPriority: Valid range of ' + rangeDays + ' days');

  try {
    var usersStartTime = new Date().getTime();
    if (!_performanceCache.users || !isCacheValid()) {
      _performanceCache.users = getUsers();
      Logger.log('recommendForOpenShiftsClaimsPriority: Loaded ' + Object.keys(_performanceCache.users).length + ' users (fresh)');
    } else {
      Logger.log('recommendForOpenShiftsClaimsPriority: Using cached users (' + Object.keys(_performanceCache.users).length + ')');
    }
    var users = _performanceCache.users;
    Logger.log('Step 1/4: Users loaded in ' + (new Date().getTime() - usersStartTime) + 'ms');

    var shiftsStartTime = new Date().getTime();
    var shiftsKey = fromDate.toISOString() + '|' + toDate.toISOString();
    if (!_performanceCache.shifts || _performanceCache.shiftsDateRange !== shiftsKey || !isCacheValid()) {
      _performanceCache.shifts = fetchShifts(fromDate, toDate);
      _performanceCache.shiftsDateRange = shiftsKey;
      _performanceCache.lastCacheTime = new Date().getTime();
      Logger.log('recommendForOpenShiftsClaimsPriority: Fetched ' + _performanceCache.shifts.length + ' shifts (fresh)');
    } else {
      Logger.log('recommendForOpenShiftsClaimsPriority: Using cached shifts (' + _performanceCache.shifts.length + ')');
    }
    Logger.log('Step 2/4: Shifts loaded in ' + (new Date().getTime() - shiftsStartTime) + 'ms');

    var openShiftsStartTime = new Date().getTime();
    var now = new Date();
    var openShifts = (_performanceCache.shifts || []).filter(function(s) {
      // CRITICAL: Only include future shifts for recommendations
      var shiftStartTime = s.startTime * 1000; // Convert Unix seconds to milliseconds
      var shiftDate = new Date(shiftStartTime);
      var isFuture = shiftDate > now;

      if (!isFuture) {
        Logger.log('recommendForOpenShiftsClaimsPriority: Excluding past shift ID=' + s.id + ' starting ' + shiftDate.toDateString() + ' - already occurred');
        return false;
      }

      var isOpenShift = s.isOpenShift === true;
      var hasAcceptedStatus = false;
      if (s.statuses && Array.isArray(s.statuses)) {
        hasAcceptedStatus = s.statuses.some(function(status) {
          return status.status === 'accepted';
        });
      }
      var openSpots = s.openSpots || 0;
      var hasNoAssignedUsers = !s.assignedUserIds || s.assignedUserIds.length === 0;
      var isTrulyOpen = isOpenShift && !hasAcceptedStatus && openSpots > 0;
      return isTrulyOpen || (isOpenShift && hasNoAssignedUsers);
    }).map(function(s) {
      var jobName = 'Unknown Open Shift';

      if (s.job && s.job.title) {
        jobName = s.job.title;
      } else if (s.jobId) {
        var job = jobCache[s.jobId];
        if (!job) {
          job = getJobById(s.jobId);
        }
        jobName = job ? job.title : 'Open Job (' + s.jobId.substring(0, 8) + '...)';
      } else if (s.title) {
        jobName = s.title;
      }

      Logger.log('recommendForOpenShiftsClaimsPriority: Open shift ID=' + s.id + ', jobName="' + jobName + '", type=' + jobTypeFromName(jobName) + ', has claimRequests=' + !!(s.claimRequests) + ', claimRequests count=' + (s.claimRequests ? s.claimRequests.length : 0));

      return {
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        jobId: s.jobId,
        jobName: jobName,
        type: jobTypeFromName(jobName),
        isOpenShift: s.isOpenShift,
        title: s.title || jobName,
        statuses: s.statuses || [],
        claimRequests: s.claimRequests || [] // CRITICAL: Pass through claimRequests from API
      };
    });
    Logger.log('Step 3/4: Open shifts filtered in ' + (new Date().getTime() - openShiftsStartTime) + 'ms - found ' + openShifts.length + ' open shifts');

    if (openShifts.length === 0) {
      Logger.log('recommendForOpenShiftsClaimsPriority: No open shifts available');
      return {
        assignments: [],
        summary: {
          info: 'No open shifts found in the date range ' + fromDate.toDateString() + ' to ' + toDate.toDateString()
        }
      };
    }

    var slots = [];
    var invalidSlots = 0;

    openShifts.forEach(function(shift) {
      Logger.log('recommendForOpenShiftsClaimsPriority: Processing shift ID=' + shift.id);

      var startTime, endTime;

      if (typeof shift.startTime === 'string') {
        startTime = new Date(shift.startTime).getTime();
        endTime = new Date(shift.endTime).getTime();
      } else if (typeof shift.startTime === 'number') {
        if (shift.startTime > 1e10) {
          startTime = shift.startTime;
          endTime = shift.endTime;
        } else {
          startTime = shift.startTime * 1000;
          endTime = shift.endTime * 1000;
        }
      } else {
        Logger.log('recommendForOpenShiftsClaimsPriority ERROR: Invalid timestamp type for shift ' + shift.id);
        invalidSlots++;
        return;
      }

      if (!startTime || !endTime || isNaN(startTime) || isNaN(endTime) || startTime >= endTime) {
        Logger.log('recommendForOpenShiftsClaimsPriority ERROR: Invalid parsed timestamps - ID=' + shift.id);
        invalidSlots++;
        return;
      }

      Logger.log('recommendForOpenShiftsClaimsPriority: Valid shift ID=' + shift.id);

      // CRITICAL FIX: Extract claims from statuses array
      // Connecteam API provides claims in shift.statuses with status='claim_requested'
      // The userId is stored in the 'assignedUserId' field, NOT 'userId'
      var claimRequests = [];

      if (shift.statuses && Array.isArray(shift.statuses)) {
        // Extract from statuses array (Connecteam standard format)
        claimRequests = shift.statuses.filter(function(status) {
          return status.status === 'claim_requested' && status.assignedUserId != null;
        }).map(function(status) {
          return {
            userId: status.assignedUserId,
            status: status.status
          };
        });
        Logger.log('recommendForOpenShiftsClaimsPriority: Shift ' + shift.id + ' has ' + claimRequests.length + ' claim requests from statuses array (using assignedUserId field)');
      } else if (shift.claimRequests && Array.isArray(shift.claimRequests)) {
        // Fallback to claimRequests if available
        claimRequests = shift.claimRequests.filter(function(claim) {
          return claim.status === 'claim_requested' && (claim.userId != null || claim.assignedUserId != null);
        }).map(function(claim) {
          return {
            userId: claim.userId || claim.assignedUserId,
            status: claim.status
          };
        });
        Logger.log('recommendForOpenShiftsClaimsPriority: Shift ' + shift.id + ' has ' + claimRequests.length + ' claim requests from claimRequests field');
      }

      slots.push({
        id: shift.id,
        startTime: startTime,
        endTime: endTime,
        type: shift.type || jobTypeFromName(shift.jobName),
        jobId: shift.jobId,
        jobName: shift.jobName,
        title: shift.title,
        claimRequests: claimRequests
      });
    });

    if (invalidSlots > 0) {
      Logger.log('recommendForOpenShiftsClaimsPriority ERROR: Skipped ' + invalidSlots + ' invalid shifts');
    }

    Logger.log('recommendForOpenShiftsClaimsPriority: Created ' + slots.length + ' valid assignment slots');

    if (slots.length === 0) {
      return {
        assignments: [],
        summary: {
          error: 'No valid shifts available for assignment after validation',
          details: 'Found ' + openShifts.length + ' open shifts but ' + invalidSlots + ' had invalid timestamps'
        }
      };
    }

    // CLAIMS PRIORITY: Use the claims-priority version of the assignment algorithm
    var result = suggestAssignmentsWithClaimsPriority(slots, { enforce24hSoft: true, excludedUserIds: excludedUserIds });
    Logger.log('recommendForOpenShiftsClaimsPriority: suggestAssignmentsWithClaimsPriority returned ' + result.assignments.length + ' assignments');

    var relevantUserIds = new Set();
    var uniqueShiftTypes = new Set();

    slots.forEach(function(slot) {
      uniqueShiftTypes.add(slot.type);
    });

    Object.keys(users).forEach(function(uid) {
      var user = users[uid];
      var userRole = user.role || '';

      var canWorkAnyShift = Array.from(uniqueShiftTypes).some(function(shiftType) {
        return roleMatchesType(userRole, shiftType);
      });

      if (canWorkAnyShift) {
        relevantUserIds.add(uid);
      }
    });

    Logger.log('recommendForOpenShiftsClaimsPriority: OPTIMIZED - Only calculating fairness for ' + relevantUserIds.size + ' relevant users');

    var fairnessStartTime = new Date().getTime();
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var historicalStart = new Date(fromDate);
    historicalStart.setMonth(historicalStart.getMonth() - 2);

    var futureEnd = new Date(fromDate);
    futureEnd.setMonth(futureEnd.getMonth() + 1);

    var fairnessKey = historicalStart.toISOString() + '|' + today.toISOString() + '|' + futureEnd.toISOString();
    var fairCounts, workedCounts;

    if (_performanceCache.fairnessCounts && _performanceCache.fairnessDateRange === fairnessKey && isCacheValid()) {
      Logger.log('recommendForOpenShiftsClaimsPriority: Using cached optimized fairness counts');
      fairCounts = _performanceCache.fairnessCounts;
      workedCounts = _performanceCache.workedCounts;
    } else {
      Logger.log('recommendForOpenShiftsClaimsPriority: Computing fresh OPTIMIZED fairness');
      workedCounts = getRollingWorkedCountsRange(historicalStart, today);
      fairCounts = getRollingShiftCountsRange(today, futureEnd);

      _performanceCache.fairnessCounts = fairCounts;
      _performanceCache.workedCounts = workedCounts;
      _performanceCache.fairnessDateRange = fairnessKey;
      _performanceCache.lastCacheTime = new Date().getTime();
    }
    Logger.log('Step 4/4: Fairness calculations completed in ' + (new Date().getTime() - fairnessStartTime) + 'ms');

    function combineFairnessMaps(a, b, relevantUsers) {
      var out = {};

      relevantUsers.forEach(function(uid) {
        var ca = a[uid] || { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
        var cb = b[uid] || { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
        var byType = {};
        Object.keys(ca.byType || {}).forEach(function(t){ byType[t] = (byType[t] || 0) + ca.byType[t]; });
        Object.keys(cb.byType || {}).forEach(function(t){ byType[t] = (byType[t] || 0) + cb.byType[t]; });
        var hoursByType = {};
        Object.keys(ca.hoursByType || {}).forEach(function(t){ hoursByType[t] = (hoursByType[t] || 0) + ca.hoursByType[t]; });
        Object.keys(cb.hoursByType || {}).forEach(function(t){ hoursByType[t] = (hoursByType[t] || 0) + cb.hoursByType[t]; });
        out[uid] = {
          total: (ca.total || 0) + (cb.total || 0),
          byType: byType,
          hoursTotal: (ca.hoursTotal || 0) + (cb.hoursTotal || 0),
          hoursByType: hoursByType
        };
      });
      return out;
    }

    var combinedCounts = combineFairnessMaps(fairCounts, workedCounts, relevantUserIds);
    Logger.log('recommendForOpenShiftsClaimsPriority: Retrieved combined fairness counts for ' + Object.keys(combinedCounts).length + ' relevant users');

    var dynamicCombinedCounts = combineFairnessMaps(fairCounts, workedCounts, relevantUserIds);

    result.assignments.forEach(function(a, index) {
      if (a.assignedUserId) {
        var user = users[a.assignedUserId] || {};

        var fairness = dynamicCombinedCounts[a.assignedUserId] || { total: 0, hoursTotal: 0, byType: {}, hoursByType: {} };
        var type = a.type || 'Unknown';
        var typeCount = (fairness.byType && fairness.byType[type]) || 0;
        var totalCount = fairness.total || 0;
        var hoursType = (fairness.hoursByType && fairness.hoursByType[type]) || 0;
        var hoursTotal = fairness.hoursTotal || 0;

        // Build clear claim status message
        var claimStatus = '';
        if (a.totalClaims > 0) {
          if (a.wasClaimed) {
            claimStatus = '✓ CLAIMED by ' + a.assignedUserName;
            if (a.totalClaims > 1) {
              claimStatus += ' (1 of ' + a.totalClaims + ' claimants - selected by fairness among claimants)';
            } else {
              claimStatus += ' (ONLY claimant - automatically assigned)';
            }
          } else {
            claimStatus = '⚠ No claims matched (had ' + a.totalClaims + ' claimants but all were unavailable/excluded)';
          }
        } else {
          claimStatus = 'No claims for this shift';
        }

        var reason = 'CLAIMS PRIORITY MODE: ' + claimStatus + '. Assigned to ' + a.assignedUserName + ' (role: ' + a.role + '). ' +
                     'Fairness BEFORE assignment: ' + type + ' shifts=' + typeCount + ', total=' + totalCount + ', ' +
                     type + ' hrs=' + hoursType.toFixed(1) + 'h, total hrs=' + hoursTotal.toFixed(1) + 'h.';
        if (a.violations.length > 0) {
          reason += ' Note: ' + a.violations.join(', ') + ' violation accepted due to necessity.';
        }
        a.rationale = reason;

        if (!dynamicCombinedCounts[a.assignedUserId]) {
          dynamicCombinedCounts[a.assignedUserId] = { total: 0, byType: {}, hoursTotal: 0, hoursByType: {} };
        }
        dynamicCombinedCounts[a.assignedUserId].total += 1;
        dynamicCombinedCounts[a.assignedUserId].byType[type] = (dynamicCombinedCounts[a.assignedUserId].byType[type] || 0) + 1;

        var slotHrs = (a.endTime - a.startTime) / 3600000;
        dynamicCombinedCounts[a.assignedUserId].hoursTotal += slotHrs;
        dynamicCombinedCounts[a.assignedUserId].hoursByType[type] = (dynamicCombinedCounts[a.assignedUserId].hoursByType[type] || 0) + slotHrs;

      } else {
        var shiftType = a.type || 'Unknown';
        var availableUsers = Object.keys(users).filter(function(uid) {
          var user = users[uid];
          return roleMatchesType(user.role || '', shiftType);
        });

        if (availableUsers.length === 0) {
          a.rationale = 'UNFILLED: No users available with role matching shift type "' + shiftType + '"';
        } else {
          a.rationale = 'UNFILLED: All ' + availableUsers.length + ' eligible users for "' + shiftType + '" are either unavailable, excluded, or violate scheduling constraints';
        }
      }
    });

    Logger.log('recommendForOpenShiftsClaimsPriority: Generated ' + result.assignments.length + ' recommendations with rationale added');

    return result;

  } catch (error) {
    Logger.log('recommendForOpenShiftsClaimsPriority: Unexpected error - ' + error.message + '\nStack: ' + error.stack);
    return {
      assignments: [],
      summary: {
        error: 'Failed to generate recommendations: ' + error.message,
        details: 'Date range: ' + fromDate.toDateString() + ' to ' + toDate.toDateString()
      }
    };
  } finally {
    Logger.log('=== recommendForOpenShiftsClaimsPriority END ===');
  }
}
