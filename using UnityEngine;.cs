using UnityEngine;

/// <summary>
/// GyroFlightController — SkyFront: Gyro Aces
/// Translates device gyroscope input into smooth aircraft pitch & roll.
/// Applies continuous forward thrust with realistic drag, gravity influence,
/// and stall mechanics. Designed for mobile (portrait or landscape).
/// </summary>
[RequireComponent(typeof(Rigidbody))]
public class GyroFlightController : MonoBehaviour
{
    // ─── Aircraft Tuning ────────────────────────────────────────────────────
    [Header("Thrust")]
    [Tooltip("Maximum engine thrust force (Newtons equivalent)")]
    [SerializeField] private float maxThrust         = 800f;
    [Tooltip("Minimum throttle so the plane never goes fully dead")]
    [SerializeField] private float minThrottleFactor = 0.2f;

    [Header("Flight Surfaces")]
    [SerializeField] private float pitchAuthority    = 55f;  // deg/s
    [SerializeField] private float rollAuthority     = 90f;  // deg/s
    [SerializeField] private float yawAuthority      = 20f;  // deg/s (coordinated turn)

    [Header("Drag & Lift")]
    [SerializeField] private float liftCoefficient   = 1.8f;
    [SerializeField] private float dragCoefficient   = 0.04f;
    [SerializeField] private float inducedDragFactor = 0.012f;

    [Header("Stall")]
    [Tooltip("Speed (m/s) below which control authority degrades")]
    [SerializeField] private float stallSpeed        = 40f;
    [Tooltip("Speed (m/s) where full authority is restored")]
    [SerializeField] private float fullControlSpeed  = 70f;

    [Header("Gyro Smoothing")]
    [SerializeField] private float gyroSmoothing     = 12f;
    [Tooltip("Deadzone in degrees to filter gyro noise")]
    [SerializeField] private float gyroDeadzone      = 1.5f;
    [Tooltip("Calibration: tilt to hold level flight")]
    [SerializeField] private float pitchCalibration  = 15f;

    // ─── Runtime State ───────────────────────────────────────────────────────
    [Header("Runtime (Read Only)")]
    [SerializeField, Range(0f, 1f)] private float _throttle = 0.6f;
    [SerializeField] private float _currentSpeedKnots;
    [SerializeField] private bool  _isStalling;

    // ─── Private ─────────────────────────────────────────────────────────────
    private Rigidbody   _rb;
    private Gyroscope   _gyro;
    private Quaternion  _gyroOffset;       // calibration baseline
    private Quaternion  _targetRotation;
    private Vector3     _smoothedAngularInput;
    private bool        _gyroAvailable;

    // Editor / PC fallback input axes
    private float _debugPitch, _debugRoll;

    // ─── Public API ──────────────────────────────────────────────────────────
    /// <summary>Set throttle 0..1 from UI slider.</summary>
    public void SetThrottle(float value) =>
        _throttle = Mathf.Clamp01(value);

    public float CurrentSpeedKnots => _currentSpeedKnots;
    public bool  IsStalling        => _isStalling;
    public float Throttle          => _throttle;

    // ─────────────────────────────────────────────────────────────────────────
    #region Unity Lifecycle

    private void Awake()
    {
        _rb = GetComponent<Rigidbody>();
        ConfigureRigidbody();
        InitialiseGyroscope();
    }

    private void Update()
    {
        // Recalibrate on double-tap (optional convenience)
        if (Input.touchCount == 2 &&
            Input.GetTouch(0).tapCount == 2)
        {
            CalibrateGyro();
        }

        // Editor fallback: arrow keys / WASD
#if UNITY_EDITOR
        _debugPitch = Input.GetAxis("Vertical")   * pitchAuthority;
        _debugRoll  = Input.GetAxis("Horizontal") * rollAuthority;
#endif
    }

    private void FixedUpdate()
    {
        float dt = Time.fixedDeltaTime;

        Vector2 gyroInput = ReadGyroInput();          // pitch, roll in degrees
        float   authority = ComputeControlAuthority();

        ApplyRotation(gyroInput, authority, dt);
        ApplyThrust(dt);
        ApplyAerodynamics(dt);
        UpdateHUDValues();
    }

    #endregion

    // ─────────────────────────────────────────────────────────────────────────
    #region Initialisation

    private void ConfigureRigidbody()
    {
        _rb.useGravity            = true;
        _rb.mass                  = 12f;          // tuned for arcade feel
        _rb.linearDamping         = 0f;           // we handle drag manually
        _rb.angularDamping        = 3.5f;
        _rb.interpolation         = RigidbodyInterpolation.Interpolate;
        _rb.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
        // Prevent physics engine from tumbling the body on its own
        _rb.maxAngularVelocity    = 10f;
    }

    private void InitialiseGyroscope()
    {
        _gyroAvailable = SystemInfo.supportsGyroscope;
        if (_gyroAvailable)
        {
            _gyro         = Input.gyro;
            _gyro.enabled = true;
            CalibrateGyro();
            Debug.Log("[GyroFlight] Gyroscope initialised.");
        }
        else
        {
            Debug.LogWarning("[GyroFlight] No gyroscope — using keyboard fallback.");
        }

        _targetRotation = transform.rotation;
    }

    /// <summary>Snap the current device attitude as the "level flight" baseline.</summary>
    public void CalibrateGyro()
    {
        if (!_gyroAvailable) return;
        // Convert Unity's gyro space to world space
        _gyroOffset = GyroToUnity(_gyro.attitude);
        Debug.Log("[GyroFlight] Gyro calibrated.");
    }

    #endregion

    // ─────────────────────────────────────────────────────────────────────────
    #region Gyro Input

    /// <summary>
    /// Returns (pitchDeg, rollDeg) normalized to degrees-per-fixed-frame.
    /// </summary>
    private Vector2 ReadGyroInput()
    {
#if UNITY_EDITOR
        return new Vector2(_debugPitch, _debugRoll);
#endif

        if (!_gyroAvailable) return Vector2.zero;

        // Current attitude relative to calibration baseline
        Quaternion currentAttitude = GyroToUnity(_gyro.attitude);
        Quaternion delta           = Quaternion.Inverse(_gyroOffset) * currentAttitude;

        delta.ToAngleAxis(out float angle, out Vector3 axis);
        // Remap gyro axis to aircraft local axes:
        // Gyro X → Pitch,  Gyro Z → Roll
        float pitchInput = axis.x * angle;
        float rollInput  = axis.z * angle;

        // Apply calibration tilt offset so neutral hold ≈ level flight
        pitchInput -= pitchCalibration;

        // Deadzone filter
        pitchInput = ApplyDeadzone(pitchInput, gyroDeadzone);
        rollInput  = ApplyDeadzone(rollInput,  gyroDeadzone);

        return new Vector2(pitchInput, rollInput);
    }

    /// <summary>Converts Unity Gyroscope quaternion to Unity world-space convention.</summary>
    private static Quaternion GyroToUnity(Quaternion q)
    {
        // Unity gyro returns right-hand system; remap to left-hand Unity coords
        return new Quaternion(q.x, q.y, -q.z, -q.w);
    }

    private static float ApplyDeadzone(float value, float zone)
    {
        if (Mathf.Abs(value) < zone) return 0f;
        return Mathf.Sign(value) * (Mathf.Abs(value) - zone);
    }

    #endregion

    // ─────────────────────────────────────────────────────────────────────────
    #region Rotation

    private void ApplyRotation(Vector2 gyroInput, float authority, float dt)
    {
        // Target angular rates in local space (deg/s)
        float targetPitchRate = Mathf.Clamp(gyroInput.x, -1f, 1f) * pitchAuthority * authority;
        float targetRollRate  = Mathf.Clamp(gyroInput.y, -1f, 1f) * rollAuthority  * authority;

        // Coordinated (auto) yaw — proportional to roll to simulate rudder
        float targetYawRate   = targetRollRate * (yawAuthority / rollAuthority);

        Vector3 desiredAngular = new Vector3(
            targetPitchRate * Mathf.Deg2Rad,
            targetYawRate   * Mathf.Deg2Rad,
            -targetRollRate * Mathf.Deg2Rad   // Unity roll axis is negative Z
        );

        // Smooth to avoid jitter
        _smoothedAngularInput = Vector3.Lerp(
            _smoothedAngularInput,
            desiredAngular,
            gyroSmoothing * dt
        );

        // Apply as angular velocity in local space
        _rb.angularVelocity = transform.TransformDirection(_smoothedAngularInput);
    }

    /// <summary>
    /// Returns 0..1 authority scalar based on current airspeed vs stall envelope.
    /// </summary>
    private float ComputeControlAuthority()
    {
        float speed = _rb.linearVelocity.magnitude;
        _isStalling = speed < stallSpeed;
        return Mathf.Clamp01(
            Mathf.InverseLerp(stallSpeed, fullControlSpeed, speed)
        );
    }

    #endregion

    // ─────────────────────────────────────────────────────────────────────────
    #region Thrust & Aerodynamics

    private void ApplyThrust(float dt)
    {
        float effectiveThrottle = Mathf.Lerp(minThrottleFactor, 1f, _throttle);
        Vector3 thrustForce     = transform.forward * (maxThrust * effectiveThrottle);
        _rb.AddForce(thrustForce, ForceMode.Force);
    }

    private void ApplyAerodynamics(float dt)
    {
        Vector3 velocity = _rb.linearVelocity;
        float   speed    = velocity.magnitude;

        if (speed < 0.1f) return;

        // ── Lift ───────────────────────────────────────────────────────────
        // Lift acts perpendicular to velocity, proportional to speed²
        // At low speed it cannot overcome gravity → stall
        float liftMagnitude = liftCoefficient * speed * speed * 0.5f;
        liftMagnitude = Mathf.Min(liftMagnitude, _rb.mass * 25f); // cap
        Vector3 liftDir   = Vector3.Cross(velocity.normalized, transform.right).normalized;
        _rb.AddForce(liftDir * liftMagnitude, ForceMode.Force);

        // ── Parasitic Drag ─────────────────────────────────────────────────
        Vector3 drag = -velocity.normalized * (dragCoefficient * speed * speed);
        _rb.AddForce(drag, ForceMode.Force);

        // ── Induced Drag (increases at high angle-of-attack) ───────────────
        float aoa           = Vector3.Angle(transform.forward, velocity.normalized);
        float inducedDrag   = inducedDragFactor * aoa * speed;
        _rb.AddForce(-velocity.normalized * inducedDrag, ForceMode.Force);

        // ── Gravity is handled by Rigidbody.useGravity = true ─────────────
    }

    #endregion

    // ─────────────────────────────────────────────────────────────────────────
    #region HUD Data

    private void UpdateHUDValues()
    {
        // 1 m/s ≈ 1.944 knots
        _currentSpeedKnots = _rb.linearVelocity.magnitude * 1.944f;
    }

    #endregion
}